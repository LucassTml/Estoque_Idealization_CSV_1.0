"""Cadastros de apoio: categorias, depósitos e fornecedores."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, Manager, Viewer, client_ip
from app.core.errors import BusinessRuleError, ConflictError, NotFoundError
from app.models import Category, Product, StockLevel, StockMovement, Supplier, Warehouse
from app.schemas.catalog import (
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    SupplierCreate,
    SupplierOut,
    SupplierUpdate,
    WarehouseCreate,
    WarehouseOut,
    WarehouseUpdate,
)
from app.services import audit

router = APIRouter(tags=["Cadastros"])


def _commit_or_conflict(db: DB, message: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(message) from exc


# ---------- Categorias ----------
@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: DB, _: Viewer) -> list[CategoryOut]:
    counts = dict(
        db.execute(select(Product.category_id, func.count()).group_by(Product.category_id)).all()
    )
    return [
        CategoryOut(
            id=c.id, name=c.name, description=c.description, product_count=counts.get(c.id, 0)
        )
        for c in db.scalars(select(Category).order_by(Category.name))
    ]


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryCreate, db: DB, user: Manager, request: Request) -> Category:
    category = Category(**payload.model_dump())
    db.add(category)
    db.flush()
    audit.record(
        db,
        user=user,
        action="create",
        entity_type="category",
        entity_id=category.id,
        summary=f"Categoria {category.name} criada",
        ip_address=client_ip(request),
    )
    _commit_or_conflict(db, "Já existe uma categoria com este nome.")
    return category


@router.patch("/categories/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int, payload: CategoryUpdate, db: DB, user: Manager, request: Request
) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise NotFoundError("Categoria não encontrada.")
    data = payload.model_dump(exclude_unset=True)
    changes = audit.diff(category, data)
    for field, value in data.items():
        setattr(category, field, value)
    audit.record(
        db,
        user=user,
        action="update",
        entity_type="category",
        entity_id=category.id,
        summary=f"Categoria {category.name} alterada",
        changes=changes,
        ip_address=client_ip(request),
    )
    _commit_or_conflict(db, "Já existe uma categoria com este nome.")
    return category


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: DB, user: Manager, request: Request) -> None:
    category = db.get(Category, category_id)
    if category is None:
        raise NotFoundError("Categoria não encontrada.")
    audit.record(
        db,
        user=user,
        action="delete",
        entity_type="category",
        entity_id=category.id,
        summary=f"Categoria {category.name} excluída",
        ip_address=client_ip(request),
    )
    db.delete(category)  # produtos ficam sem categoria (ON DELETE SET NULL)
    db.commit()


# ---------- Depósitos ----------
@router.get("/warehouses", response_model=list[WarehouseOut])
def list_warehouses(db: DB, _: Viewer, include_inactive: bool = True) -> list[WarehouseOut]:
    stats = {
        wid: (value, skus)
        for wid, value, skus in db.execute(
            select(
                StockLevel.warehouse_id,
                func.sum(StockLevel.quantity * Product.cost_price),
                func.count(StockLevel.id),
            )
            .join(Product, Product.id == StockLevel.product_id)
            .where(StockLevel.quantity != 0)
            .group_by(StockLevel.warehouse_id)
        ).all()
    }
    stmt = select(Warehouse).order_by(Warehouse.code)
    if not include_inactive:
        stmt = stmt.where(Warehouse.is_active.is_(True))
    result = []
    for w in db.scalars(stmt):
        value, skus = stats.get(w.id, (0, 0))
        out = WarehouseOut.model_validate(w)
        out.stock_value = value or 0
        out.sku_count = skus
        result.append(out)
    return result


@router.post("/warehouses", response_model=WarehouseOut, status_code=status.HTTP_201_CREATED)
def create_warehouse(
    payload: WarehouseCreate, db: DB, user: Manager, request: Request
) -> Warehouse:
    warehouse = Warehouse(**payload.model_dump())
    db.add(warehouse)
    db.flush()
    audit.record(
        db,
        user=user,
        action="create",
        entity_type="warehouse",
        entity_id=warehouse.id,
        summary=f"Depósito {warehouse.code} criado",
        ip_address=client_ip(request),
    )
    _commit_or_conflict(db, "Já existe um depósito com este código.")
    return warehouse


@router.patch("/warehouses/{warehouse_id}", response_model=WarehouseOut)
def update_warehouse(
    warehouse_id: int, payload: WarehouseUpdate, db: DB, user: Manager, request: Request
) -> Warehouse:
    warehouse = db.get(Warehouse, warehouse_id)
    if warehouse is None:
        raise NotFoundError("Depósito não encontrado.")
    data = payload.model_dump(exclude_unset=True)
    if data.get("code"):
        data["code"] = data["code"].strip().upper()
    changes = audit.diff(warehouse, data)
    for field, value in data.items():
        setattr(warehouse, field, value)
    audit.record(
        db,
        user=user,
        action="update",
        entity_type="warehouse",
        entity_id=warehouse.id,
        summary=f"Depósito {warehouse.code} alterado",
        changes=changes,
        ip_address=client_ip(request),
    )
    _commit_or_conflict(db, "Já existe um depósito com este código.")
    return warehouse


@router.delete("/warehouses/{warehouse_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_warehouse(warehouse_id: int, db: DB, user: Manager, request: Request) -> None:
    warehouse = db.get(Warehouse, warehouse_id)
    if warehouse is None:
        raise NotFoundError("Depósito não encontrado.")
    if db.scalar(
        select(StockMovement.id).where(StockMovement.warehouse_id == warehouse_id).limit(1)
    ):
        raise BusinessRuleError(
            "Este depósito tem movimentações registradas. Desative-o em vez de excluir."
        )
    audit.record(
        db,
        user=user,
        action="delete",
        entity_type="warehouse",
        entity_id=warehouse.id,
        summary=f"Depósito {warehouse.code} excluído",
        ip_address=client_ip(request),
    )
    db.delete(warehouse)
    db.commit()


# ---------- Fornecedores ----------
@router.get("/suppliers", response_model=list[SupplierOut])
def list_suppliers(
    db: DB,
    _: Viewer,
    q: str | None = Query(default=None, max_length=100),
    active_only: bool = False,
) -> list[SupplierOut]:
    counts = dict(
        db.execute(select(Product.supplier_id, func.count()).group_by(Product.supplier_id)).all()
    )
    stmt = select(Supplier).order_by(Supplier.name)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Supplier.name.ilike(like), Supplier.document.ilike(like)))
    if active_only:
        stmt = stmt.where(Supplier.is_active.is_(True))
    result = []
    for supplier in db.scalars(stmt):
        out = SupplierOut.model_validate(supplier)
        out.product_count = counts.get(supplier.id, 0)
        result.append(out)
    return result


@router.post("/suppliers", response_model=SupplierOut, status_code=status.HTTP_201_CREATED)
def create_supplier(payload: SupplierCreate, db: DB, user: Manager, request: Request) -> Supplier:
    supplier = Supplier(**payload.model_dump())
    db.add(supplier)
    db.flush()
    audit.record(
        db,
        user=user,
        action="create",
        entity_type="supplier",
        entity_id=supplier.id,
        summary=f"Fornecedor {supplier.name} criado",
        ip_address=client_ip(request),
    )
    db.commit()
    return supplier


@router.patch("/suppliers/{supplier_id}", response_model=SupplierOut)
def update_supplier(
    supplier_id: int, payload: SupplierUpdate, db: DB, user: Manager, request: Request
) -> Supplier:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise NotFoundError("Fornecedor não encontrado.")
    data = payload.model_dump(exclude_unset=True)
    changes = audit.diff(supplier, data)
    for field, value in data.items():
        setattr(supplier, field, value)
    audit.record(
        db,
        user=user,
        action="update",
        entity_type="supplier",
        entity_id=supplier.id,
        summary=f"Fornecedor {supplier.name} alterado",
        changes=changes,
        ip_address=client_ip(request),
    )
    db.commit()
    return supplier


@router.delete("/suppliers/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_supplier(supplier_id: int, db: DB, user: Manager, request: Request) -> None:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise NotFoundError("Fornecedor não encontrado.")
    audit.record(
        db,
        user=user,
        action="delete",
        entity_type="supplier",
        entity_id=supplier.id,
        summary=f"Fornecedor {supplier.name} excluído",
        ip_address=client_ip(request),
    )
    db.delete(supplier)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise BusinessRuleError(
            "Fornecedor com pedidos de compra não pode ser excluído. Desative-o."
        ) from exc
