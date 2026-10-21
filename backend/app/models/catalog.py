from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import ZERO, Base, Cost, Price, Quantity, TimestampMixin

if TYPE_CHECKING:
    from app.models.inventory import StockLevel


class Category(TimestampMixin, Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)

    products: Mapped[list[Product]] = relationship(back_populates="category")


class Warehouse(TimestampMixin, Base):
    """Depósito, setor ou local de armazenagem (o antigo campo "setor" do CSV)."""

    __tablename__ = "warehouses"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Supplier(TimestampMixin, Base):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    document: Mapped[str | None] = mapped_column(String(20), nullable=True)  # CNPJ/CPF
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    contact_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    lead_time_days: Mapped[int] = mapped_column(Integer, default=7)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    products: Mapped[list[Product]] = relationship(back_populates="supplier")


class Product(TimestampMixin, Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    sku: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    barcode: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit: Mapped[str] = mapped_column(String(10), default="UN")
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True
    )
    supplier_id: Mapped[int | None] = mapped_column(
        ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Custo médio ponderado, recalculado a cada entrada com custo.
    cost_price: Mapped[Decimal] = mapped_column(Cost, default=ZERO)
    sale_price: Mapped[Decimal] = mapped_column(Price, default=ZERO)
    min_stock: Mapped[Decimal] = mapped_column(Quantity, default=ZERO)
    max_stock: Mapped[Decimal | None] = mapped_column(Quantity, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    category: Mapped[Category | None] = relationship(back_populates="products")
    supplier: Mapped[Supplier | None] = relationship(back_populates="products")
    stock_levels: Mapped[list[StockLevel]] = relationship(
        back_populates="product", cascade="all, delete-orphan"
    )

    @property
    def total_stock(self) -> Decimal:
        return sum((level.quantity for level in self.stock_levels), ZERO)

    @property
    def stock_value(self) -> Decimal:
        return self.total_stock * self.cost_price

    @property
    def is_below_min(self) -> bool:
        return self.min_stock > 0 and self.total_stock <= self.min_stock
