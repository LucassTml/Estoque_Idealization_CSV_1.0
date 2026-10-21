from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.api.deps import DB, Viewer
from app.models import Product, StockMovement
from app.schemas.reports import AbcOut, DashboardOut, ReplenishmentItem, TurnoverItem
from app.services import analytics, forecasting, reports
from app.services.analytics import local_date, local_tz
from app.services.reports import Column, Report

router = APIRouter(tags=["Relatórios"])

ReportName = Literal["stock-position", "movements", "abc", "turnover", "replenishment", "low-stock"]
MOVEMENT_LABELS = {
    "entry": "Entrada",
    "exit": "Saída",
    "transfer_out": "Transf. saída",
    "transfer_in": "Transf. entrada",
    "adjustment": "Ajuste",
    "receipt": "Recebimento",
}


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(db: DB, _: Viewer, days: Annotated[int, Query(ge=7, le=180)] = 30) -> dict[str, Any]:
    return analytics.dashboard_summary(db, days)


@router.get("/reports/abc", response_model=AbcOut)
def abc(db: DB, _: Viewer, days: Annotated[int, Query(ge=7, le=365)] = 90) -> dict[str, Any]:
    return analytics.abc_curve(db, days)


@router.get("/reports/turnover", response_model=list[TurnoverItem])
def turnover(
    db: DB, _: Viewer, days: Annotated[int, Query(ge=7, le=365)] = 90
) -> list[dict[str, Any]]:
    return analytics.turnover(db, days)


@router.get("/reports/replenishment", response_model=list[ReplenishmentItem])
def replenishment(db: DB, _: Viewer, only_needed: bool = True) -> list[dict[str, Any]]:
    return forecasting.replenishment_suggestions(db, only_needed=only_needed)


def _build_report(
    db: DB,
    name: ReportName,
    days: int,
    warehouse_id: int | None,
    date_from: date | None,
    date_to: date | None,
) -> Report:
    if name == "stock-position":
        rows = analytics.stock_position(db, warehouse_id)
        return Report(
            "Posição de estoque",
            [
                Column("sku", "SKU", width=1.2),
                Column("name", "Produto", width=3.5),
                Column("category", "Categoria", width=1.6),
                Column("warehouse", "Depósito", width=1),
                Column("unit", "Un.", width=0.6),
                Column("quantity", "Quantidade", "qty"),
                Column("unit_cost", "Custo médio", "money", 1.2),
                Column("value", "Valor", "money", 1.3),
            ],
            rows,
            totals={"name": "Total", "value": sum(r["value"] for r in rows)},
        )
    if name == "movements":
        tz = local_tz()
        start = date_from or (local_date(datetime.now(tz)) - timedelta(days=days - 1))
        end = date_to or local_date(datetime.now(tz))
        stmt = (
            select(StockMovement)
            .options(
                joinedload(StockMovement.product),
                joinedload(StockMovement.warehouse),
                joinedload(StockMovement.user),
            )
            .where(
                StockMovement.created_at >= datetime.combine(start, time.min, tzinfo=tz),
                StockMovement.created_at
                < datetime.combine(end + timedelta(days=1), time.min, tzinfo=tz),
            )
            .order_by(StockMovement.created_at)
        )
        if warehouse_id:
            stmt = stmt.where(StockMovement.warehouse_id == warehouse_id)
        rows = [
            {
                "date": m.created_at.astimezone(tz).strftime("%d/%m/%Y %H:%M"),
                "type": MOVEMENT_LABELS[m.type.value],
                "sku": m.product.sku,
                "name": m.product.name,
                "warehouse": m.warehouse.code,
                "quantity": float(m.quantity),
                "balance": float(m.balance_after),
                "unit_cost": float(m.unit_cost),
                "reference": m.reference or "",
                "user": m.user.name if m.user else "",
            }
            for m in db.scalars(stmt)
        ]
        return Report(
            "Movimentações",
            [
                Column("date", "Data", width=1.4),
                Column("type", "Tipo", width=1.2),
                Column("sku", "SKU", width=1.1),
                Column("name", "Produto", width=3),
                Column("warehouse", "Depósito", width=1),
                Column("quantity", "Qtd.", "qty", 0.9),
                Column("balance", "Saldo", "qty", 0.9),
                Column("unit_cost", "Custo un.", "money", 1.1),
                Column("reference", "Referência", width=1.4),
                Column("user", "Usuário", width=1.3),
            ],
            rows,
            subtitle=f"Período: {start:%d/%m/%Y} a {end:%d/%m/%Y}",
        )
    if name == "abc":
        data = analytics.abc_curve(db, days)
        return Report(
            "Curva ABC",
            [
                Column("abc_class", "Classe", width=0.7),
                Column("sku", "SKU", width=1.2),
                Column("name", "Produto", width=3.5),
                Column("category", "Categoria", width=1.6),
                Column("quantity", "Qtd. consumida", "qty", 1.2),
                Column("value", "Valor consumido", "money", 1.4),
                Column("share", "Part.", "percent", 0.8),
                Column("cumulative_share", "Acumulado", "percent", 1),
            ],
            data["items"],
            subtitle=f"Consumo dos últimos {days} dias",
            totals={"name": "Total", "value": data["total_value"]},
        )
    if name == "turnover":
        return Report(
            "Giro de estoque",
            [
                Column("sku", "SKU", width=1.2),
                Column("name", "Produto", width=3.5),
                Column("consumed", "Consumo", "qty"),
                Column("average_stock", "Estoque médio", "qty"),
                Column("current_stock", "Saldo atual", "qty"),
                Column("turnover", "Giro", "qty", 0.8),
                Column("coverage_days", "Cobertura (dias)", "qty"),
                Column("stock_value", "Valor", "money"),
            ],
            analytics.turnover(db, days),
            subtitle=f"Últimos {days} dias",
        )
    if name == "replenishment":
        rows = forecasting.replenishment_suggestions(db)
        return Report(
            "Sugestão de reposição",
            [
                Column("sku", "SKU", width=1.2),
                Column("name", "Produto", width=3),
                Column("supplier_name", "Fornecedor", width=2),
                Column("current_stock", "Saldo", "qty", 0.9),
                Column("on_order", "Pedido", "qty", 0.9),
                Column("avg_daily_demand", "Consumo/dia", "qty", 1),
                Column("days_until_stockout", "Dias p/ acabar", "qty", 1),
                Column("reorder_point", "Ponto de pedido", "qty", 1.1),
                Column("suggested_quantity", "Comprar", "qty", 0.9),
                Column("estimated_cost", "Custo estimado", "money", 1.2),
            ],
            rows,
            totals={"name": "Total", "estimated_cost": sum(r["estimated_cost"] for r in rows)},
        )
    # low-stock
    products = db.scalars(
        analytics.low_stock_query().options(
            joinedload(Product.stock_levels), joinedload(Product.supplier)
        )
    ).unique()
    rows = [
        {
            "sku": p.sku,
            "name": p.name,
            "supplier": p.supplier.name if p.supplier else "",
            "stock": float(p.total_stock),
            "min_stock": float(p.min_stock),
            "missing": float(p.min_stock - p.total_stock),
        }
        for p in products
    ]
    return Report(
        "Itens abaixo do estoque mínimo",
        [
            Column("sku", "SKU", width=1.2),
            Column("name", "Produto", width=3.5),
            Column("supplier", "Fornecedor", width=2),
            Column("stock", "Saldo", "qty"),
            Column("min_stock", "Mínimo", "qty"),
            Column("missing", "Faltam", "qty"),
        ],
        rows,
    )


@router.get("/reports/export/{name}", response_class=Response)
def export_report(
    name: ReportName,
    db: DB,
    _: Viewer,
    format: Literal["xlsx", "csv", "pdf"] = "xlsx",
    days: Annotated[int, Query(ge=1, le=365)] = 30,
    warehouse_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Response:
    report = _build_report(db, name, days, warehouse_id, date_from, date_to)
    content = reports.render(report, format)
    filename = f"{name}-{datetime.now(local_tz()):%Y%m%d-%H%M}.{format}"
    return Response(
        content,
        media_type=reports.MEDIA_TYPES[format],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
