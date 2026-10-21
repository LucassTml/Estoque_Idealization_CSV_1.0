"""Regras de movimentação de estoque.

Toda alteração de saldo passa por `_apply`, que:
  1. trava o saldo do depósito (SELECT ... FOR UPDATE no PostgreSQL);
  2. impede saldo negativo;
  3. grava a linha imutável no livro de movimentações com o saldo resultante;
  4. dispara a verificação de estoque mínimo.
"""

from __future__ import annotations

import uuid
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import BusinessRuleError, InsufficientStockError, NotFoundError
from app.models import MovementType, Product, StockLevel, StockMovement, User, Warehouse
from app.models.base import ZERO
from app.services import alerts

COST_PLACES = Decimal("0.0001")


def get_product(db: Session, product_id: int) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise NotFoundError("Produto não encontrado.")
    return product


def get_warehouse(db: Session, warehouse_id: int, *, require_active: bool = True) -> Warehouse:
    warehouse = db.get(Warehouse, warehouse_id)
    if warehouse is None:
        raise NotFoundError("Depósito não encontrado.")
    if require_active and not warehouse.is_active:
        raise BusinessRuleError(f"O depósito {warehouse.code} está inativo.")
    return warehouse


def _locked_level(db: Session, product_id: int, warehouse_id: int) -> StockLevel:
    stmt = (
        select(StockLevel)
        .where(StockLevel.product_id == product_id, StockLevel.warehouse_id == warehouse_id)
        .with_for_update()
    )
    level = db.scalars(stmt).first()
    if level is None:
        level = StockLevel(product_id=product_id, warehouse_id=warehouse_id, quantity=ZERO)
        db.add(level)
        db.flush()
    return level


def total_quantity(db: Session, product_id: int) -> Decimal:
    stmt = select(func.coalesce(func.sum(StockLevel.quantity), 0)).where(
        StockLevel.product_id == product_id
    )
    return Decimal(str(db.scalar(stmt) or 0))


def _apply(
    db: Session,
    *,
    product: Product,
    warehouse: Warehouse,
    type_: MovementType,
    delta: Decimal,
    user: User | None,
    unit_cost: Decimal | None = None,
    reference: str | None = None,
    notes: str | None = None,
    transfer_id: str | None = None,
    purchase_order_id: int | None = None,
    check_alerts: bool = True,
) -> StockMovement:
    if not product.is_active and delta > 0:
        raise BusinessRuleError(f"O produto {product.sku} está inativo.")

    previous_total = total_quantity(db, product.id)
    level = _locked_level(db, product.id, warehouse.id)
    new_balance = level.quantity + delta
    if new_balance < 0:
        raise InsufficientStockError(
            f"Estoque insuficiente de {product.sku} em {warehouse.code}: "
            f"disponível {level.quantity.normalize():f}, solicitado {(-delta).normalize():f}."
        )
    level.quantity = new_balance

    movement = StockMovement(
        product_id=product.id,
        warehouse_id=warehouse.id,
        type=type_,
        quantity=delta,
        balance_after=new_balance,
        unit_cost=unit_cost if unit_cost is not None else product.cost_price,
        reference=reference,
        notes=notes,
        transfer_id=transfer_id,
        purchase_order_id=purchase_order_id,
        user_id=user.id if user else None,
    )
    db.add(movement)
    db.flush()
    db.refresh(product, attribute_names=["stock_levels"])

    if check_alerts:
        alerts.evaluate_product(db, product, previous_total=previous_total)
    return movement


def _update_average_cost(
    product: Product, current_total: Decimal, qty: Decimal, cost: Decimal
) -> None:
    """Custo médio ponderado: (saldo × custo atual + entrada × custo da entrada) / novo saldo."""
    base = max(current_total, ZERO)
    new_total = base + qty
    if new_total <= 0:
        return
    average = (base * product.cost_price + qty * cost) / new_total
    product.cost_price = average.quantize(COST_PLACES, rounding=ROUND_HALF_UP)


def register_entry(
    db: Session,
    *,
    product_id: int,
    warehouse_id: int,
    quantity: Decimal,
    user: User | None,
    unit_cost: Decimal | None = None,
    reference: str | None = None,
    notes: str | None = None,
    type_: MovementType = MovementType.ENTRY,
    purchase_order_id: int | None = None,
) -> StockMovement:
    product = get_product(db, product_id)
    warehouse = get_warehouse(db, warehouse_id)
    if unit_cost is not None:
        _update_average_cost(product, total_quantity(db, product.id), quantity, unit_cost)
    return _apply(
        db,
        product=product,
        warehouse=warehouse,
        type_=type_,
        delta=quantity,
        user=user,
        unit_cost=unit_cost,
        reference=reference,
        notes=notes,
        purchase_order_id=purchase_order_id,
    )


def register_exit(
    db: Session,
    *,
    product_id: int,
    warehouse_id: int,
    quantity: Decimal,
    user: User | None,
    reference: str | None = None,
    notes: str | None = None,
) -> StockMovement:
    product = get_product(db, product_id)
    warehouse = get_warehouse(db, warehouse_id, require_active=False)
    return _apply(
        db,
        product=product,
        warehouse=warehouse,
        type_=MovementType.EXIT,
        delta=-quantity,
        user=user,
        reference=reference,
        notes=notes,
    )


def transfer(
    db: Session,
    *,
    product_id: int,
    from_warehouse_id: int,
    to_warehouse_id: int,
    quantity: Decimal,
    user: User | None,
    notes: str | None = None,
) -> tuple[StockMovement, StockMovement]:
    if from_warehouse_id == to_warehouse_id:
        raise BusinessRuleError("Origem e destino devem ser depósitos diferentes.")
    product = get_product(db, product_id)
    origin = get_warehouse(db, from_warehouse_id, require_active=False)
    destination = get_warehouse(db, to_warehouse_id)
    transfer_id = str(uuid.uuid4())
    reference = f"{origin.code} → {destination.code}"
    out = _apply(
        db,
        product=product,
        warehouse=origin,
        type_=MovementType.TRANSFER_OUT,
        delta=-quantity,
        user=user,
        reference=reference,
        notes=notes,
        transfer_id=transfer_id,
        check_alerts=False,  # o total do produto não muda numa transferência
    )
    inbound = _apply(
        db,
        product=product,
        warehouse=destination,
        type_=MovementType.TRANSFER_IN,
        delta=quantity,
        user=user,
        reference=reference,
        notes=notes,
        transfer_id=transfer_id,
        check_alerts=False,
    )
    return out, inbound


def adjust(
    db: Session,
    *,
    product_id: int,
    warehouse_id: int,
    counted_quantity: Decimal,
    user: User | None,
    notes: str,
) -> StockMovement | None:
    """Ajuste de inventário: grava a diferença entre o contado e o saldo do sistema."""
    product = get_product(db, product_id)
    warehouse = get_warehouse(db, warehouse_id, require_active=False)
    level = _locked_level(db, product.id, warehouse.id)
    delta = counted_quantity - level.quantity
    if delta == 0:
        return None
    return _apply(
        db,
        product=product,
        warehouse=warehouse,
        type_=MovementType.ADJUSTMENT,
        delta=delta,
        user=user,
        reference="Inventário",
        notes=notes,
    )
