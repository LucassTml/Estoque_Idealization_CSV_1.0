from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.models.enums import MovementType
from app.schemas.common import IdName, Money, Num, ORMModel, PositiveQty, Qty


class ProductRef(ORMModel):
    id: int
    sku: str
    name: str
    unit: str


class WarehouseRef(ORMModel):
    id: int
    code: str
    name: str


class EntryRequest(BaseModel):
    product_id: int
    warehouse_id: int
    quantity: PositiveQty
    unit_cost: Money | None = Field(
        default=None,
        description="Custo unitário da entrada. Se informado, recalcula o custo médio.",
    )
    reference: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=1000)


class ExitRequest(BaseModel):
    product_id: int
    warehouse_id: int
    quantity: PositiveQty
    reference: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=1000)


class TransferRequest(BaseModel):
    product_id: int
    from_warehouse_id: int
    to_warehouse_id: int
    quantity: PositiveQty
    notes: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def different_warehouses(self) -> TransferRequest:
        if self.from_warehouse_id == self.to_warehouse_id:
            raise ValueError("Origem e destino devem ser depósitos diferentes.")
        return self


class AdjustmentRequest(BaseModel):
    product_id: int
    warehouse_id: int
    counted_quantity: Qty = Field(ge=0, description="Quantidade contada fisicamente.")
    notes: str = Field(min_length=3, max_length=1000, description="Motivo do ajuste.")


class MovementOut(ORMModel):
    id: int
    type: MovementType
    product: ProductRef
    warehouse: WarehouseRef
    quantity: Num
    balance_after: Num
    unit_cost: Num
    reference: str | None
    notes: str | None
    transfer_id: str | None
    purchase_order_id: int | None
    user: IdName | None
    created_at: datetime


class StockLevelOut(BaseModel):
    product: ProductRef
    warehouse: WarehouseRef
    quantity: Num
    value: Num
    min_stock: Num
