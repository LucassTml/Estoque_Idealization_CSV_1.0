from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from app.models.enums import PurchaseOrderStatus
from app.schemas.common import IdName, Money, Num, ORMModel, PositiveQty
from app.schemas.inventory import ProductRef, WarehouseRef


class PurchaseOrderItemIn(BaseModel):
    product_id: int
    quantity_ordered: PositiveQty
    unit_cost: Money


class PurchaseOrderCreate(BaseModel):
    supplier_id: int
    warehouse_id: int
    expected_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    items: list[PurchaseOrderItemIn] = Field(min_length=1)


class PurchaseOrderUpdate(BaseModel):
    supplier_id: int | None = None
    warehouse_id: int | None = None
    expected_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    items: list[PurchaseOrderItemIn] | None = Field(default=None, min_length=1)


class PurchaseOrderItemOut(ORMModel):
    id: int
    product: ProductRef
    quantity_ordered: Num
    quantity_received: Num
    quantity_pending: Num
    unit_cost: Num


class PurchaseOrderOut(ORMModel):
    id: int
    number: str
    supplier: IdName
    warehouse: WarehouseRef
    status: PurchaseOrderStatus
    expected_date: date | None
    total: Num
    item_count: int = 0
    created_by: IdName | None
    created_at: datetime
    ordered_at: datetime | None
    received_at: datetime | None


class PurchaseOrderDetail(PurchaseOrderOut):
    notes: str | None
    items: list[PurchaseOrderItemOut]


class ReceiveItem(BaseModel):
    item_id: int
    quantity: PositiveQty
    unit_cost: Money | None = Field(
        default=None, description="Custo real na nota fiscal, se diferente do pedido."
    )


class ReceiveRequest(BaseModel):
    items: list[ReceiveItem] = Field(min_length=1)
    notes: str | None = Field(default=None, max_length=1000)


class FromSuggestionsRequest(BaseModel):
    warehouse_id: int
    product_ids: list[int] | None = Field(
        default=None, description="Restringe a estes produtos. Vazio = todas as sugestões."
    )
