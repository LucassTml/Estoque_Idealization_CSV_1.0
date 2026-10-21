"""Ciclo de compras: rascunho → enviado → recebido (parcial ou total) | cancelado."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import BusinessRuleError, NotFoundError
from app.models import (
    MovementType,
    Product,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseOrderStatus,
    Supplier,
    User,
)
from app.models.base import utcnow
from app.schemas.purchasing import PurchaseOrderItemIn, ReceiveItem
from app.services import forecasting, inventory

EDITABLE = {PurchaseOrderStatus.DRAFT}
RECEIVABLE = {PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED}


def get_order(db: Session, order_id: int) -> PurchaseOrder:
    order = db.get(PurchaseOrder, order_id)
    if order is None:
        raise NotFoundError("Pedido de compra não encontrado.")
    return order


def _next_number(db: Session) -> str:
    year = utcnow().year
    prefix = f"PC-{year}-"
    last = db.scalar(
        select(func.max(PurchaseOrder.number)).where(PurchaseOrder.number.like(f"{prefix}%"))
    )
    sequence = int(last.rsplit("-", 1)[-1]) + 1 if last else 1
    return f"{prefix}{sequence:05d}"


def _validate_supplier(db: Session, supplier_id: int) -> Supplier:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise NotFoundError("Fornecedor não encontrado.")
    if not supplier.is_active:
        raise BusinessRuleError("Fornecedor inativo.")
    return supplier


def _build_items(db: Session, items: list[PurchaseOrderItemIn]) -> list[PurchaseOrderItem]:
    product_ids = [item.product_id for item in items]
    if len(product_ids) != len(set(product_ids)):
        raise BusinessRuleError("O mesmo produto aparece mais de uma vez no pedido.")
    found = set(db.scalars(select(Product.id).where(Product.id.in_(product_ids))))
    missing = set(product_ids) - found
    if missing:
        raise NotFoundError(f"Produtos não encontrados: {sorted(missing)}")
    return [
        PurchaseOrderItem(
            product_id=item.product_id,
            quantity_ordered=item.quantity_ordered,
            unit_cost=item.unit_cost,
        )
        for item in items
    ]


def create_order(
    db: Session,
    *,
    supplier_id: int,
    warehouse_id: int,
    items: list[PurchaseOrderItemIn],
    user: User | None,
    expected_date=None,  # type: ignore[no-untyped-def]
    notes: str | None = None,
) -> PurchaseOrder:
    _validate_supplier(db, supplier_id)
    inventory.get_warehouse(db, warehouse_id)
    order = PurchaseOrder(
        number=_next_number(db),
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        expected_date=expected_date,
        notes=notes,
        created_by_id=user.id if user else None,
        items=_build_items(db, items),
    )
    db.add(order)
    db.flush()
    return order


def update_order(db: Session, order: PurchaseOrder, data: dict) -> PurchaseOrder:
    if order.status not in EDITABLE:
        raise BusinessRuleError("Só é possível editar pedidos em rascunho.")
    if "supplier_id" in data and data["supplier_id"] is not None:
        _validate_supplier(db, data["supplier_id"])
        order.supplier_id = data["supplier_id"]
    if "warehouse_id" in data and data["warehouse_id"] is not None:
        inventory.get_warehouse(db, data["warehouse_id"])
        order.warehouse_id = data["warehouse_id"]
    for field in ("expected_date", "notes"):
        if field in data:
            setattr(order, field, data[field])
    if data.get("items"):
        order.items.clear()
        db.flush()
        order.items.extend(_build_items(db, [PurchaseOrderItemIn(**i) for i in data["items"]]))
    db.flush()
    return order


def submit_order(db: Session, order: PurchaseOrder) -> PurchaseOrder:
    if order.status != PurchaseOrderStatus.DRAFT:
        raise BusinessRuleError("Apenas rascunhos podem ser enviados ao fornecedor.")
    if not order.items:
        raise BusinessRuleError("O pedido não tem itens.")
    order.status = PurchaseOrderStatus.ORDERED
    order.ordered_at = utcnow()
    return order


def cancel_order(db: Session, order: PurchaseOrder) -> PurchaseOrder:
    if order.status in {PurchaseOrderStatus.RECEIVED, PurchaseOrderStatus.CANCELLED}:
        raise BusinessRuleError("Este pedido não pode mais ser cancelado.")
    if any(item.quantity_received > 0 for item in order.items):
        raise BusinessRuleError(
            "O pedido já teve recebimentos. Encerre-o recebendo o restante ou ajuste os itens."
        )
    order.status = PurchaseOrderStatus.CANCELLED
    return order


def receive_order(
    db: Session,
    order: PurchaseOrder,
    receipts: list[ReceiveItem],
    *,
    user: User | None,
    notes: str | None = None,
) -> PurchaseOrder:
    if order.status not in RECEIVABLE:
        raise BusinessRuleError("Só é possível receber pedidos enviados ao fornecedor.")
    items = {item.id: item for item in order.items}
    for receipt in receipts:
        item = items.get(receipt.item_id)
        if item is None:
            raise NotFoundError(f"Item {receipt.item_id} não pertence a este pedido.")
        if receipt.quantity > item.quantity_pending:
            raise BusinessRuleError(
                f"{item.product.sku}: recebendo {receipt.quantity.normalize():f}, "
                f"mas só faltam {item.quantity_pending.normalize():f}."
            )
        cost = receipt.unit_cost if receipt.unit_cost is not None else item.unit_cost
        inventory.register_entry(
            db,
            product_id=item.product_id,
            warehouse_id=order.warehouse_id,
            quantity=receipt.quantity,
            unit_cost=cost,
            user=user,
            reference=order.number,
            notes=notes,
            type_=MovementType.RECEIPT,
            purchase_order_id=order.id,
        )
        item.quantity_received += receipt.quantity

    if all(item.quantity_pending == 0 for item in order.items):
        order.status = PurchaseOrderStatus.RECEIVED
        order.received_at = utcnow()
    else:
        order.status = PurchaseOrderStatus.PARTIALLY_RECEIVED
    db.flush()
    return order


def create_from_suggestions(
    db: Session, *, warehouse_id: int, product_ids: list[int] | None, user: User | None
) -> list[PurchaseOrder]:
    """Agrupa as sugestões de reposição por fornecedor e cria um rascunho para cada um."""
    suggestions = forecasting.replenishment_suggestions(db)
    if product_ids:
        wanted = set(product_ids)
        suggestions = [s for s in suggestions if s["product_id"] in wanted]
    by_supplier: dict[int, list[dict]] = defaultdict(list)
    skipped = []
    for suggestion in suggestions:
        if suggestion["supplier_id"] is None:
            skipped.append(suggestion["sku"])
            continue
        by_supplier[suggestion["supplier_id"]].append(suggestion)
    if not by_supplier:
        message = "Nenhuma sugestão com fornecedor definido."
        if skipped:
            message += f" Produtos sem fornecedor: {', '.join(skipped[:10])}."
        raise BusinessRuleError(message)

    orders = []
    for supplier_id, group in by_supplier.items():
        items = [
            PurchaseOrderItemIn(
                product_id=s["product_id"],
                quantity_ordered=Decimal(str(s["suggested_quantity"])),
                unit_cost=Decimal(str(s["unit_cost"])),
            )
            for s in group
        ]
        orders.append(
            create_order(
                db,
                supplier_id=supplier_id,
                warehouse_id=warehouse_id,
                items=items,
                user=user,
                notes="Gerado automaticamente a partir das sugestões de reposição.",
            )
        )
    return orders
