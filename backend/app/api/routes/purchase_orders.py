from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import joinedload, selectinload

from app.api.deps import DB, Manager, Operator, PageParams, Viewer, client_ip
from app.models import PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus, Supplier
from app.schemas.common import Page
from app.schemas.purchasing import (
    FromSuggestionsRequest,
    PurchaseOrderCreate,
    PurchaseOrderDetail,
    PurchaseOrderOut,
    PurchaseOrderUpdate,
    ReceiveRequest,
)
from app.services import audit, purchasing, reports
from app.services.settings_store import get_general_settings

router = APIRouter(prefix="/purchase-orders", tags=["Compras"])

LABELS = {
    PurchaseOrderStatus.DRAFT: "rascunho",
    PurchaseOrderStatus.ORDERED: "enviado",
    PurchaseOrderStatus.PARTIALLY_RECEIVED: "recebido parcialmente",
    PurchaseOrderStatus.RECEIVED: "recebido",
    PurchaseOrderStatus.CANCELLED: "cancelado",
}


def _load(db: DB, order_id: int) -> PurchaseOrder:
    purchasing.get_order(db, order_id)
    return db.scalar(
        select(PurchaseOrder)
        .options(
            joinedload(PurchaseOrder.supplier),
            joinedload(PurchaseOrder.warehouse),
            joinedload(PurchaseOrder.created_by),
            selectinload(PurchaseOrder.items).joinedload(PurchaseOrderItem.product),
        )
        .where(PurchaseOrder.id == order_id)
        .execution_options(populate_existing=True)
    )


def _detail(order: PurchaseOrder) -> PurchaseOrderDetail:
    detail = PurchaseOrderDetail.model_validate(order)
    detail.item_count = len(order.items)
    return detail


@router.get("", response_model=Page[PurchaseOrderOut])
def list_orders(
    db: DB,
    _: Viewer,
    page: PageParams,
    status_filter: Annotated[list[PurchaseOrderStatus] | None, Query(alias="status")] = None,
    supplier_id: int | None = None,
    q: Annotated[str | None, Query(max_length=60)] = None,
) -> Page[PurchaseOrderOut]:
    stmt = select(PurchaseOrder).join(Supplier, Supplier.id == PurchaseOrder.supplier_id)
    if status_filter:
        stmt = stmt.where(PurchaseOrder.status.in_(status_filter))
    if supplier_id:
        stmt = stmt.where(PurchaseOrder.supplier_id == supplier_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(PurchaseOrder.number.ilike(like), Supplier.name.ilike(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    orders = db.scalars(
        stmt.options(
            joinedload(PurchaseOrder.supplier),
            joinedload(PurchaseOrder.warehouse),
            joinedload(PurchaseOrder.created_by),
            selectinload(PurchaseOrder.items),
        )
        .order_by(PurchaseOrder.created_at.desc(), PurchaseOrder.id.desc())
        .offset(page.offset)
        .limit(page.page_size)
    ).unique()
    items = []
    for order in orders:
        out = PurchaseOrderOut.model_validate(order)
        out.item_count = len(order.items)
        items.append(out)
    return Page[PurchaseOrderOut].build(items, total, page.page, page.page_size)


@router.get("/{order_id}", response_model=PurchaseOrderDetail)
def get_order(order_id: int, db: DB, _: Viewer) -> PurchaseOrderDetail:
    return _detail(_load(db, order_id))


@router.post("", response_model=PurchaseOrderDetail, status_code=status.HTTP_201_CREATED)
def create_order(
    payload: PurchaseOrderCreate, db: DB, user: Manager, request: Request
) -> PurchaseOrderDetail:
    order = purchasing.create_order(
        db, user=user, **payload.model_dump(exclude={"items"}), items=payload.items
    )
    audit.record(
        db,
        user=user,
        action="create",
        entity_type="purchase_order",
        entity_id=order.id,
        summary=f"Pedido {order.number} criado",
        ip_address=client_ip(request),
    )
    db.commit()
    return _detail(_load(db, order.id))


@router.post(
    "/from-suggestions", response_model=list[PurchaseOrderOut], status_code=status.HTTP_201_CREATED
)
def create_from_suggestions(
    payload: FromSuggestionsRequest, db: DB, user: Manager, request: Request
) -> list[PurchaseOrderOut]:
    """Gera um rascunho de pedido por fornecedor a partir da previsão de demanda."""
    orders = purchasing.create_from_suggestions(
        db, warehouse_id=payload.warehouse_id, product_ids=payload.product_ids, user=user
    )
    for order in orders:
        audit.record(
            db,
            user=user,
            action="create",
            entity_type="purchase_order",
            entity_id=order.id,
            summary=f"Pedido {order.number} gerado pelas sugestões de reposição",
            ip_address=client_ip(request),
        )
    db.commit()
    result = []
    for order in orders:
        out = PurchaseOrderOut.model_validate(_load(db, order.id))
        out.item_count = len(order.items)
        result.append(out)
    return result


@router.patch("/{order_id}", response_model=PurchaseOrderDetail)
def update_order(
    order_id: int, payload: PurchaseOrderUpdate, db: DB, user: Manager, request: Request
) -> PurchaseOrderDetail:
    order = _load(db, order_id)
    purchasing.update_order(db, order, payload.model_dump(exclude_unset=True))
    audit.record(
        db,
        user=user,
        action="update",
        entity_type="purchase_order",
        entity_id=order.id,
        summary=f"Pedido {order.number} alterado",
        ip_address=client_ip(request),
    )
    db.commit()
    return _detail(_load(db, order.id))


@router.post("/{order_id}/submit", response_model=PurchaseOrderDetail)
def submit_order(order_id: int, db: DB, user: Manager, request: Request) -> PurchaseOrderDetail:
    order = _load(db, order_id)
    purchasing.submit_order(db, order)
    audit.record(
        db,
        user=user,
        action="submit",
        entity_type="purchase_order",
        entity_id=order.id,
        summary=f"Pedido {order.number} enviado ao fornecedor",
        ip_address=client_ip(request),
    )
    db.commit()
    return _detail(_load(db, order.id))


@router.post("/{order_id}/cancel", response_model=PurchaseOrderDetail)
def cancel_order(order_id: int, db: DB, user: Manager, request: Request) -> PurchaseOrderDetail:
    order = _load(db, order_id)
    purchasing.cancel_order(db, order)
    audit.record(
        db,
        user=user,
        action="cancel",
        entity_type="purchase_order",
        entity_id=order.id,
        summary=f"Pedido {order.number} cancelado",
        ip_address=client_ip(request),
    )
    db.commit()
    return _detail(_load(db, order.id))


@router.post("/{order_id}/receive", response_model=PurchaseOrderDetail)
def receive_order(
    order_id: int, payload: ReceiveRequest, db: DB, user: Operator, request: Request
) -> PurchaseOrderDetail:
    """Registra o recebimento (total ou parcial): gera entradas no estoque e atualiza o custo médio."""
    order = _load(db, order_id)
    purchasing.receive_order(db, order, payload.items, user=user, notes=payload.notes)
    audit.record(
        db,
        user=user,
        action="receive",
        entity_type="purchase_order",
        entity_id=order.id,
        summary=f"Recebimento do pedido {order.number} ({LABELS[order.status]})",
        ip_address=client_ip(request),
    )
    db.commit()
    return _detail(_load(db, order.id))


@router.get("/{order_id}/pdf", response_class=Response)
def order_pdf(order_id: int, db: DB, _: Viewer) -> Response:
    order = _load(db, order_id)
    content = reports.purchase_order_pdf(order, get_general_settings(db).company_name)
    return Response(
        content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{order.number}.pdf"'},
    )
