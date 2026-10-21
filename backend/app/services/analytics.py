"""Indicadores do dashboard, curva ABC, giro de estoque e posição de estoque."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.models import (
    Category,
    MovementType,
    Product,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseOrderStatus,
    StockLevel,
    StockMovement,
    Warehouse,
)
from app.models.base import ZERO, utcnow

INBOUND = {MovementType.ENTRY, MovementType.RECEIPT}
OPEN_PO = [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED]


@lru_cache
def local_tz() -> ZoneInfo:
    return ZoneInfo(get_settings().timezone)


def local_date(moment: datetime) -> date:
    return moment.astimezone(local_tz()).date()


def product_totals_subquery():  # type: ignore[no-untyped-def]
    return (
        select(StockLevel.product_id, func.sum(StockLevel.quantity).label("total"))
        .group_by(StockLevel.product_id)
        .subquery()
    )


def _d(value: Any) -> Decimal:
    return Decimal(str(value or 0))


def stock_value(db: Session) -> Decimal:
    stmt = select(func.coalesce(func.sum(StockLevel.quantity * Product.cost_price), 0)).join(
        Product, Product.id == StockLevel.product_id
    )
    return _d(db.scalar(stmt))


def low_stock_query() -> Select[tuple[Product]]:
    totals = product_totals_subquery()
    total = func.coalesce(totals.c.total, 0)
    return (
        select(Product)
        .outerjoin(totals, totals.c.product_id == Product.id)
        .where(Product.is_active.is_(True), Product.min_stock > 0, total <= Product.min_stock)
    )


def dashboard_summary(db: Session, days: int = 30) -> dict[str, Any]:
    totals = product_totals_subquery()
    total = func.coalesce(totals.c.total, 0)

    active_products = db.scalar(select(func.count()).where(Product.is_active.is_(True))) or 0
    below_min = db.scalar(select(func.count()).select_from(low_stock_query().subquery())) or 0
    out_of_stock = (
        db.scalar(
            select(func.count())
            .select_from(Product)
            .outerjoin(totals, totals.c.product_id == Product.id)
            .where(Product.is_active.is_(True), total <= 0)
        )
        or 0
    )
    open_po = db.execute(
        select(
            func.count(func.distinct(PurchaseOrder.id)),
            func.coalesce(
                func.sum(
                    (PurchaseOrderItem.quantity_ordered - PurchaseOrderItem.quantity_received)
                    * PurchaseOrderItem.unit_cost
                ),
                0,
            ),
        )
        .join(PurchaseOrderItem, PurchaseOrderItem.purchase_order_id == PurchaseOrder.id)
        .where(PurchaseOrder.status.in_(OPEN_PO))
    ).one()

    # Série diária de entradas e saídas (agregada no fuso local)
    today = local_date(utcnow())
    start = today - timedelta(days=days - 1)
    since = datetime.combine(start, datetime.min.time(), tzinfo=local_tz())
    rows = db.execute(
        select(
            StockMovement.type,
            StockMovement.quantity,
            StockMovement.unit_cost,
            StockMovement.created_at,
            StockMovement.product_id,
        ).where(StockMovement.created_at >= since)
    ).all()
    series: dict[date, dict[str, Decimal]] = {
        start + timedelta(days=i): {
            "in_value": ZERO,
            "out_value": ZERO,
            "in_qty": ZERO,
            "out_qty": ZERO,
        }
        for i in range(days)
    }
    exits_by_product: dict[int, Decimal] = defaultdict(lambda: ZERO)
    for type_, qty, cost, created_at, product_id in rows:
        bucket = series.get(local_date(created_at))
        if bucket is None:
            continue
        if type_ in INBOUND:
            bucket["in_qty"] += qty
            bucket["in_value"] += qty * cost
        elif type_ == MovementType.EXIT:
            bucket["out_qty"] += -qty
            bucket["out_value"] += -qty * cost
            exits_by_product[product_id] += -qty

    by_category = db.execute(
        select(
            func.coalesce(Category.name, "Sem categoria"),
            func.sum(StockLevel.quantity * Product.cost_price),
        )
        .join(Product, Product.id == StockLevel.product_id)
        .outerjoin(Category, Category.id == Product.category_id)
        .group_by(Category.name)
    ).all()
    by_warehouse = db.execute(
        select(Warehouse.code, Warehouse.name, func.sum(StockLevel.quantity * Product.cost_price))
        .join(StockLevel, StockLevel.warehouse_id == Warehouse.id)
        .join(Product, Product.id == StockLevel.product_id)
        .group_by(Warehouse.code, Warehouse.name)
    ).all()

    top_ids = sorted(exits_by_product, key=exits_by_product.__getitem__, reverse=True)[:5]
    top_products = {p.id: p for p in db.scalars(select(Product).where(Product.id.in_(top_ids)))}

    return {
        "active_products": active_products,
        "stock_value": float(stock_value(db)),
        "below_min_count": below_min,
        "out_of_stock_count": out_of_stock,
        "open_purchase_orders": open_po[0],
        "open_purchase_value": float(_d(open_po[1])),
        "movements_period": len(rows),
        "period_days": days,
        "series": [
            {"date": day.isoformat(), **{k: float(v) for k, v in values.items()}}
            for day, values in sorted(series.items())
        ],
        "value_by_category": sorted(
            ({"name": name, "value": float(_d(value))} for name, value in by_category if value),
            key=lambda item: item["value"],
            reverse=True,
        ),
        "value_by_warehouse": [
            {"code": code, "name": name, "value": float(_d(value))}
            for code, name, value in by_warehouse
        ],
        "top_exits": [
            {
                "product_id": pid,
                "sku": top_products[pid].sku,
                "name": top_products[pid].name,
                "quantity": float(exits_by_product[pid]),
            }
            for pid in top_ids
            if pid in top_products
        ],
    }


def abc_curve(db: Session, days: int = 90) -> dict[str, Any]:
    """Classifica produtos pelo valor consumido no período: A = 80%, B = próximos 15%, C = resto."""
    since = utcnow() - timedelta(days=days)
    consumption = dict(
        db.execute(
            select(
                StockMovement.product_id,
                func.sum(-StockMovement.quantity * StockMovement.unit_cost),
            )
            .where(StockMovement.type == MovementType.EXIT, StockMovement.created_at >= since)
            .group_by(StockMovement.product_id)
        ).all()
    )
    quantities = dict(
        db.execute(
            select(StockMovement.product_id, func.sum(-StockMovement.quantity))
            .where(StockMovement.type == MovementType.EXIT, StockMovement.created_at >= since)
            .group_by(StockMovement.product_id)
        ).all()
    )
    products = db.scalars(
        select(Product).options(joinedload(Product.category)).where(Product.is_active.is_(True))
    ).all()
    grand_total = sum((_d(v) for v in consumption.values()), ZERO)
    ranked = sorted(products, key=lambda p: _d(consumption.get(p.id)), reverse=True)

    items = []
    cumulative = ZERO
    summary = {k: {"count": 0, "value": 0.0} for k in "ABC"}
    for product in ranked:
        value = _d(consumption.get(product.id))
        share = value / grand_total if grand_total else ZERO
        previous = cumulative
        cumulative += share
        klass = "A" if previous < Decimal("0.80") else "B" if previous < Decimal("0.95") else "C"
        if value == 0:
            klass = "C"
        summary[klass]["count"] += 1
        summary[klass]["value"] += float(value)
        items.append(
            {
                "product_id": product.id,
                "sku": product.sku,
                "name": product.name,
                "category": product.category.name if product.category else None,
                "quantity": float(_d(quantities.get(product.id))),
                "value": float(value),
                "share": float(share),
                "cumulative_share": float(cumulative),
                "abc_class": klass,
            }
        )
    return {
        "period_days": days,
        "total_value": float(grand_total),
        "summary": summary,
        "items": items,
    }


def turnover(db: Session, days: int = 90) -> list[dict[str, Any]]:
    """Giro = consumo do período ÷ estoque médio; cobertura = saldo ÷ consumo diário."""
    since = utcnow() - timedelta(days=days)
    consumed = dict(
        db.execute(
            select(StockMovement.product_id, func.sum(-StockMovement.quantity))
            .where(StockMovement.type == MovementType.EXIT, StockMovement.created_at >= since)
            .group_by(StockMovement.product_id)
        ).all()
    )
    net_change = dict(
        db.execute(
            select(StockMovement.product_id, func.sum(StockMovement.quantity))
            .where(StockMovement.created_at >= since)
            .group_by(StockMovement.product_id)
        ).all()
    )
    products = db.scalars(
        select(Product).options(joinedload(Product.stock_levels)).where(Product.is_active.is_(True))
    ).unique()
    result = []
    for product in products:
        end = product.total_stock
        start = end - _d(net_change.get(product.id))
        average = (start + end) / 2
        used = _d(consumed.get(product.id))
        daily = used / days
        result.append(
            {
                "product_id": product.id,
                "sku": product.sku,
                "name": product.name,
                "unit": product.unit,
                "consumed": float(used),
                "average_stock": float(average),
                "current_stock": float(end),
                "turnover": float(used / average) if average > 0 else None,
                "coverage_days": float(end / daily) if daily > 0 else None,
                "stock_value": float(product.stock_value),
            }
        )
    result.sort(key=lambda r: r["turnover"] or 0, reverse=True)
    return result


def stock_position(db: Session, warehouse_id: int | None = None) -> list[dict[str, Any]]:
    stmt = (
        select(StockLevel)
        .options(
            joinedload(StockLevel.product).joinedload(Product.category),
            joinedload(StockLevel.warehouse),
        )
        .join(Product, Product.id == StockLevel.product_id)
        .join(Warehouse, Warehouse.id == StockLevel.warehouse_id)
        .where(StockLevel.quantity != 0)
        .order_by(Product.name, Warehouse.code)
    )
    if warehouse_id:
        stmt = stmt.where(StockLevel.warehouse_id == warehouse_id)
    rows = []
    for level in db.scalars(stmt):
        product = level.product
        rows.append(
            {
                "sku": product.sku,
                "name": product.name,
                "category": product.category.name if product.category else "",
                "warehouse": level.warehouse.code,
                "unit": product.unit,
                "quantity": float(level.quantity),
                "unit_cost": float(product.cost_price),
                "value": float(level.quantity * product.cost_price),
                "min_stock": float(product.min_stock),
            }
        )
    return rows
