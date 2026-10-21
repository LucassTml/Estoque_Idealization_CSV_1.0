from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.common import IdName, Money, Num, ORMModel, Qty


def _strip_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


# ---------- Categorias ----------
class CategoryBase(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=255)


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=255)


class CategoryOut(ORMModel, CategoryBase):
    id: int
    product_count: int = 0


# ---------- Depósitos ----------
class WarehouseBase(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=255)
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def upper_code(cls, value: str) -> str:
        return value.strip().upper()


class WarehouseCreate(WarehouseBase):
    pass


class WarehouseUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=20)
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None


class WarehouseOut(ORMModel, WarehouseBase):
    id: int
    stock_value: Num = Decimal(0)
    sku_count: int = 0


# ---------- Fornecedores ----------
class SupplierBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    document: str | None = Field(default=None, max_length=20)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=30)
    contact_name: str | None = Field(default=None, max_length=120)
    address: str | None = Field(default=None, max_length=255)
    notes: str | None = None
    lead_time_days: int = Field(default=7, ge=0, le=365)
    is_active: bool = True

    @field_validator(
        "document", "email", "phone", "contact_name", "address", "notes", mode="before"
    )
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return _strip_or_none(value) if isinstance(value, str) else value


class SupplierCreate(SupplierBase):
    pass


class SupplierUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    document: str | None = Field(default=None, max_length=20)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=30)
    contact_name: str | None = Field(default=None, max_length=120)
    address: str | None = Field(default=None, max_length=255)
    notes: str | None = None
    lead_time_days: int | None = Field(default=None, ge=0, le=365)
    is_active: bool | None = None

    @field_validator(
        "document", "email", "phone", "contact_name", "address", "notes", mode="before"
    )
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return _strip_or_none(value) if isinstance(value, str) else value


class SupplierOut(ORMModel):
    id: int
    name: str
    document: str | None
    email: str | None
    phone: str | None
    contact_name: str | None
    address: str | None
    notes: str | None
    lead_time_days: int
    is_active: bool
    product_count: int = 0


# ---------- Produtos ----------
class ProductBase(BaseModel):
    sku: str = Field(min_length=1, max_length=40)
    barcode: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None
    unit: str = Field(default="UN", min_length=1, max_length=10)
    category_id: int | None = None
    supplier_id: int | None = None
    sale_price: Money = Decimal(0)
    min_stock: Qty = Field(default=Decimal(0), ge=0)
    max_stock: Qty | None = Field(default=None, ge=0)
    is_active: bool = True

    @field_validator("sku", "unit")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("barcode", "description", mode="before")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return _strip_or_none(value) if isinstance(value, str) else value


class ProductCreate(ProductBase):
    cost_price: Money = Decimal(0)


class ProductUpdate(BaseModel):
    sku: str | None = Field(default=None, min_length=1, max_length=40)
    barcode: str | None = Field(default=None, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = None
    unit: str | None = Field(default=None, min_length=1, max_length=10)
    category_id: int | None = None
    supplier_id: int | None = None
    cost_price: Money | None = None
    sale_price: Money | None = None
    min_stock: Qty | None = Field(default=None, ge=0)
    max_stock: Qty | None = Field(default=None, ge=0)
    is_active: bool | None = None

    @field_validator("sku", "unit")
    @classmethod
    def normalize_code(cls, value: str | None) -> str | None:
        return value.strip().upper() if value else value

    @field_validator("barcode", "description", mode="before")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return _strip_or_none(value) if isinstance(value, str) else value


class StockByWarehouse(BaseModel):
    warehouse_id: int
    warehouse_code: str
    warehouse_name: str
    quantity: Num


class ProductOut(ORMModel):
    id: int
    sku: str
    barcode: str | None
    name: str
    description: str | None
    unit: str
    category: IdName | None
    supplier: IdName | None
    cost_price: Num
    sale_price: Num
    min_stock: Num
    max_stock: Num | None
    is_active: bool
    total_stock: Num
    stock_value: Num
    is_below_min: bool
    created_at: datetime
    updated_at: datetime


class ProductDetail(ProductOut):
    stock: list[StockByWarehouse]
