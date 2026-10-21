from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Annotated

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import joinedload

from app.api.deps import DB, Manager, Operator, PageParams, Viewer, client_ip
from app.models import MovementType, Product, StockLevel, StockMovement, Warehouse
from app.schemas.common import Page
from app.schemas.inventory import (
    AdjustmentRequest,
    EntryRequest,
    ExitRequest,
    MovementOut,
    ProductRef,
    StockLevelOut,
    TransferRequest,
    WarehouseRef,
)
from app.services import audit, inventory
from app.services.analytics import local_tz

router = APIRouter(prefix="/stock", tags=["Estoque"])


def _out(db: DB, movement_id: int) -> MovementOut:
    movement = db.scalar(
        select(StockMovement)
        .options(
            joinedload(StockMovement.product),
            joinedload(StockMovement.warehouse),
            joinedload(StockMovement.user),
        )
        .where(StockMovement.id == movement_id)
    )
    return MovementOut.model_validate(movement)


@router.get("/levels", response_model=list[StockLevelOut])
def stock_levels(
    db: DB,
    _: Viewer,
    warehouse_id: int | None = None,
    product_id: int | None = None,
    include_zero: bool = False,
) -> list[StockLevelOut]:
    stmt = (
        select(StockLevel)
        .options(joinedload(StockLevel.product), joinedload(StockLevel.warehouse))
        .join(Product, Product.id == StockLevel.product_id)
        .order_by(Product.name)
    )
    if warehouse_id:
        stmt = stmt.where(StockLevel.warehouse_id == warehouse_id)
    if product_id:
        stmt = stmt.where(StockLevel.product_id == product_id)
    if not include_zero:
        stmt = stmt.where(StockLevel.quantity != 0)
    return [
        StockLevelOut(
            product=ProductRef.model_validate(level.product),
            warehouse=WarehouseRef.model_validate(level.warehouse),
            quantity=level.quantity,
            value=level.quantity * level.product.cost_price,
            min_stock=level.product.min_stock,
        )
        for level in db.scalars(stmt)
    ]


@router.get("/movements", response_model=Page[MovementOut])
def list_movements(
    db: DB,
    _: Viewer,
    page: PageParams,
    product_id: int | None = None,
    warehouse_id: int | None = None,
    user_id: int | None = None,
    type: Annotated[list[MovementType] | None, Query()] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: Annotated[str | None, Query(max_length=80, description="SKU, produto ou referência")] = None,
) -> Page[MovementOut]:
    stmt = (
        select(StockMovement)
        .join(Product, Product.id == StockMovement.product_id)
        .join(Warehouse, Warehouse.id == StockMovement.warehouse_id)
    )
    if product_id:
        stmt = stmt.where(StockMovement.product_id == product_id)
    if warehouse_id:
        stmt = stmt.where(StockMovement.warehouse_id == warehouse_id)
    if user_id:
        stmt = stmt.where(StockMovement.user_id == user_id)
    if type:
        stmt = stmt.where(StockMovement.type.in_(type))
    tz = local_tz()
    if date_from:
        stmt = stmt.where(
            StockMovement.created_at >= datetime.combine(date_from, time.min, tzinfo=tz)
        )
    if date_to:
        stmt = stmt.where(
            StockMovement.created_at
            < datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=tz)
        )
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            Product.sku.ilike(like) | Product.name.ilike(like) | StockMovement.reference.ilike(like)
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.options(
            joinedload(StockMovement.product),
            joinedload(StockMovement.warehouse),
            joinedload(StockMovement.user),
        )
        .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
        .offset(page.offset)
        .limit(page.page_size)
    ).all()
    return Page[MovementOut].build(
        [MovementOut.model_validate(m) for m in rows], total, page.page, page.page_size
    )


@router.post("/entries", response_model=MovementOut, status_code=status.HTTP_201_CREATED)
def register_entry(payload: EntryRequest, db: DB, user: Operator, request: Request) -> MovementOut:
    movement = inventory.register_entry(db, user=user, **payload.model_dump())
    audit.record(
        db,
        user=user,
        action="stock_entry",
        entity_type="product",
        entity_id=payload.product_id,
        summary=f"Entrada de {payload.quantity.normalize():f} ({movement.product.sku})",
        ip_address=client_ip(request),
    )
    db.commit()
    return _out(db, movement.id)


@router.post("/exits", response_model=MovementOut, status_code=status.HTTP_201_CREATED)
def register_exit(payload: ExitRequest, db: DB, user: Operator, request: Request) -> MovementOut:
    movement = inventory.register_exit(db, user=user, **payload.model_dump())
    audit.record(
        db,
        user=user,
        action="stock_exit",
        entity_type="product",
        entity_id=payload.product_id,
        summary=f"Saída de {payload.quantity.normalize():f} ({movement.product.sku})",
        ip_address=client_ip(request),
    )
    db.commit()
    return _out(db, movement.id)


@router.post("/transfers", response_model=list[MovementOut], status_code=status.HTTP_201_CREATED)
def transfer(
    payload: TransferRequest, db: DB, user: Operator, request: Request
) -> list[MovementOut]:
    out, inbound = inventory.transfer(db, user=user, **payload.model_dump())
    audit.record(
        db,
        user=user,
        action="stock_transfer",
        entity_type="product",
        entity_id=payload.product_id,
        summary=f"Transferência de {payload.quantity.normalize():f} ({out.product.sku}) {out.reference}",
        ip_address=client_ip(request),
    )
    db.commit()
    return [_out(db, out.id), _out(db, inbound.id)]


@router.post("/adjustments", response_model=MovementOut | None)
def adjust(
    payload: AdjustmentRequest, db: DB, user: Manager, request: Request
) -> MovementOut | None:
    """Ajuste por contagem física. Retorna `null` se a contagem bater com o sistema."""
    movement = inventory.adjust(db, user=user, **payload.model_dump())
    if movement is None:
        return None
    audit.record(
        db,
        user=user,
        action="stock_adjustment",
        entity_type="product",
        entity_id=payload.product_id,
        summary=f"Ajuste de inventário ({movement.product.sku}): {movement.quantity.normalize():+f}",
        changes={"reason": payload.notes},
        ip_address=client_ip(request),
    )
    db.commit()
    return _out(db, movement.id)
