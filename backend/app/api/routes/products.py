from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload, selectinload

from app.api.deps import DB, Manager, PageParams, Viewer, client_ip
from app.core.errors import ConflictError, NotFoundError
from app.models import Category, Product, StockLevel, StockMovement, Supplier
from app.schemas.catalog import (
    ProductCreate,
    ProductDetail,
    ProductOut,
    ProductUpdate,
    StockByWarehouse,
)
from app.schemas.common import Page
from app.schemas.inventory import MovementOut
from app.schemas.reports import ForecastOut
from app.services import audit, forecasting
from app.services.analytics import product_totals_subquery

router = APIRouter(prefix="/products", tags=["Produtos"])

SortField = Literal[
    "name", "-name", "sku", "-sku", "stock", "-stock", "value", "-value", "updated", "-updated"
]


def _detail(product: Product) -> ProductDetail:
    base = ProductOut.model_validate(product).model_dump()
    stock = [
        StockByWarehouse(
            warehouse_id=level.warehouse_id,
            warehouse_code=level.warehouse.code,
            warehouse_name=level.warehouse.name,
            quantity=level.quantity,
        )
        for level in sorted(product.stock_levels, key=lambda lv: lv.warehouse.code)
    ]
    return ProductDetail(**base, stock=stock)


def _load(db: DB, product_id: int) -> Product:
    product = db.scalar(
        select(Product)
        .options(
            joinedload(Product.category),
            joinedload(Product.supplier),
            selectinload(Product.stock_levels).joinedload(StockLevel.warehouse),
        )
        .where(Product.id == product_id)
    )
    if product is None:
        raise NotFoundError("Produto não encontrado.")
    return product


def _validate_refs(db: DB, data: dict[str, Any]) -> None:
    if data.get("category_id") is not None and db.get(Category, data["category_id"]) is None:
        raise NotFoundError("Categoria não encontrada.")
    if data.get("supplier_id") is not None and db.get(Supplier, data["supplier_id"]) is None:
        raise NotFoundError("Fornecedor não encontrado.")


def _commit(db: DB) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("Já existe um produto com este SKU ou código de barras.") from exc


@router.get("", response_model=Page[ProductOut])
def list_products(
    db: DB,
    _: Viewer,
    page: PageParams,
    q: Annotated[
        str | None, Query(max_length=100, description="Nome, SKU ou código de barras")
    ] = None,
    category_id: int | None = None,
    supplier_id: int | None = None,
    warehouse_id: int | None = None,
    stock_status: Annotated[
        Literal["all", "low", "out", "ok"], Query(description="Situação do estoque")
    ] = "all",
    active: bool | None = True,
    sort: SortField = "name",
) -> Page[ProductOut]:
    totals = product_totals_subquery()
    total = func.coalesce(totals.c.total, 0)
    stmt = select(Product).outerjoin(totals, totals.c.product_id == Product.id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(Product.name.ilike(like), Product.sku.ilike(like), Product.barcode.ilike(like))
        )
    if category_id:
        stmt = stmt.where(Product.category_id == category_id)
    if supplier_id:
        stmt = stmt.where(Product.supplier_id == supplier_id)
    if warehouse_id:
        stmt = stmt.where(
            Product.id.in_(
                select(StockLevel.product_id).where(
                    StockLevel.warehouse_id == warehouse_id, StockLevel.quantity != 0
                )
            )
        )
    if active is not None:
        stmt = stmt.where(Product.is_active.is_(active))
    if stock_status == "low":
        stmt = stmt.where(Product.min_stock > 0, total <= Product.min_stock, total > 0)
    elif stock_status == "out":
        stmt = stmt.where(total <= 0)
    elif stock_status == "ok":
        stmt = stmt.where(total > Product.min_stock)

    count = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = {
        "name": Product.name,
        "sku": Product.sku,
        "stock": total,
        "value": total * Product.cost_price,
        "updated": Product.updated_at,
    }[sort.lstrip("-")]
    stmt = stmt.order_by(order.desc() if sort.startswith("-") else order.asc(), Product.id)
    products = db.scalars(
        stmt.options(
            joinedload(Product.category),
            joinedload(Product.supplier),
            selectinload(Product.stock_levels),
        )
        .offset(page.offset)
        .limit(page.page_size)
    ).unique()
    items = [ProductOut.model_validate(p) for p in products]
    return Page[ProductOut].build(items, count, page.page, page.page_size)


@router.get("/lookup", response_model=ProductDetail)
def lookup(
    db: DB, _: Viewer, code: Annotated[str, Query(min_length=1, max_length=64)]
) -> ProductDetail:
    """Busca exata por código de barras ou SKU (usado pelo scanner)."""
    code = code.strip()
    product_id = db.scalar(
        select(Product.id).where(or_(Product.barcode == code, Product.sku == code.upper()))
    )
    if product_id is None:
        raise NotFoundError(f"Nenhum produto com o código {code}.")
    return _detail(_load(db, product_id))


@router.get("/{product_id}", response_model=ProductDetail)
def get_product(product_id: int, db: DB, _: Viewer) -> ProductDetail:
    return _detail(_load(db, product_id))


@router.post("", response_model=ProductDetail, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate, db: DB, user: Manager, request: Request
) -> ProductDetail:
    data = payload.model_dump()
    _validate_refs(db, data)
    product = Product(**data)
    db.add(product)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("Já existe um produto com este SKU ou código de barras.") from exc
    audit.record(
        db,
        user=user,
        action="create",
        entity_type="product",
        entity_id=product.id,
        summary=f"Produto {product.sku} criado",
        ip_address=client_ip(request),
    )
    _commit(db)
    return _detail(_load(db, product.id))


@router.patch("/{product_id}", response_model=ProductDetail)
def update_product(
    product_id: int, payload: ProductUpdate, db: DB, user: Manager, request: Request
) -> ProductDetail:
    product = _load(db, product_id)
    data = payload.model_dump(exclude_unset=True)
    _validate_refs(db, data)
    changes = audit.diff(product, data)
    for field, value in data.items():
        setattr(product, field, value)
    if changes:
        audit.record(
            db,
            user=user,
            action="update",
            entity_type="product",
            entity_id=product.id,
            summary=f"Produto {product.sku} alterado",
            changes=changes,
            ip_address=client_ip(request),
        )
    _commit(db)
    return _detail(_load(db, product.id))


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(product_id: int, db: DB, user: Manager, request: Request) -> None:
    """Exclui o produto se nunca foi movimentado; caso contrário apenas o desativa (preserva o histórico)."""
    product = _load(db, product_id)
    has_history = db.scalar(
        select(StockMovement.id).where(StockMovement.product_id == product_id).limit(1)
    )
    if has_history:
        product.is_active = False
        summary = f"Produto {product.sku} desativado (possui histórico)"
    else:
        db.delete(product)
        summary = f"Produto {product.sku} excluído"
    audit.record(
        db,
        user=user,
        action="delete",
        entity_type="product",
        entity_id=product_id,
        summary=summary,
        ip_address=client_ip(request),
    )
    db.commit()


@router.get("/{product_id}/movements", response_model=Page[MovementOut])
def product_movements(product_id: int, db: DB, _: Viewer, page: PageParams) -> Page[MovementOut]:
    """Ficha de estoque (kardex) do produto."""
    _load(db, product_id)
    base = select(StockMovement).where(StockMovement.product_id == product_id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.options(
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


@router.get("/{product_id}/forecast", response_model=ForecastOut)
def product_forecast(product_id: int, db: DB, _: Viewer) -> dict[str, Any]:
    """Histórico de consumo, previsão diária e sugestão de compra do produto."""
    return forecasting.product_forecast(db, _load(db, product_id))
