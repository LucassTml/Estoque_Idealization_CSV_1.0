from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import ZERO, Base, Cost, Quantity, TimestampMixin, UTCDateTime
from app.models.catalog import Product, Supplier, Warehouse
from app.models.enums import PurchaseOrderStatus
from app.models.user import User


class PurchaseOrder(TimestampMixin, Base):
    __tablename__ = "purchase_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(20), unique=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id", ondelete="RESTRICT"))
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"))
    status: Mapped[PurchaseOrderStatus] = mapped_column(
        Enum(
            PurchaseOrderStatus,
            native_enum=False,
            length=20,
            values_callable=lambda e: [m.value for m in e],
        ),
        default=PurchaseOrderStatus.DRAFT,
        index=True,
    )
    expected_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    ordered_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    supplier: Mapped[Supplier] = relationship()
    warehouse: Mapped[Warehouse] = relationship()
    created_by: Mapped[User | None] = relationship()
    items: Mapped[list[PurchaseOrderItem]] = relationship(
        back_populates="purchase_order",
        cascade="all, delete-orphan",
        order_by="PurchaseOrderItem.id",
    )

    @property
    def total(self) -> Decimal:
        return sum((item.quantity_ordered * item.unit_cost for item in self.items), ZERO)


class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    purchase_order_id: Mapped[int] = mapped_column(
        ForeignKey("purchase_orders.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"))
    quantity_ordered: Mapped[Decimal] = mapped_column(Quantity)
    quantity_received: Mapped[Decimal] = mapped_column(Quantity, default=ZERO)
    unit_cost: Mapped[Decimal] = mapped_column(Cost, default=ZERO)

    purchase_order: Mapped[PurchaseOrder] = relationship(back_populates="items")
    product: Mapped[Product] = relationship()

    @property
    def quantity_pending(self) -> Decimal:
        return max(self.quantity_ordered - self.quantity_received, ZERO)
