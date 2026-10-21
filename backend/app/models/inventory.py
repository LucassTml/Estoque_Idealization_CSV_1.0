from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import Enum, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import ZERO, Base, Cost, Quantity, UTCDateTime, utcnow
from app.models.catalog import Product, Warehouse
from app.models.enums import MovementType
from app.models.user import User


class StockLevel(Base):
    """Saldo atual de um produto em um depósito. É derivado do livro de movimentações."""

    __tablename__ = "stock_levels"
    __table_args__ = (UniqueConstraint("product_id", "warehouse_id", name="uq_stock_level"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    quantity: Mapped[Decimal] = mapped_column(Quantity, default=ZERO)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    product: Mapped[Product] = relationship(back_populates="stock_levels")
    warehouse: Mapped[Warehouse] = relationship()


class StockMovement(Base):
    """Livro (ledger) imutável de movimentações. Cada linha altera o saldo de um único depósito.

    `quantity` tem sinal: positivo entra, negativo sai. Transferências geram duas linhas
    ligadas pelo mesmo `transfer_id`.
    """

    __tablename__ = "stock_movements"
    __table_args__ = (
        Index("ix_movements_product_created", "product_id", "created_at"),
        Index("ix_movements_type_created", "type", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"))
    type: Mapped[MovementType] = mapped_column(
        Enum(
            MovementType,
            native_enum=False,
            length=20,
            values_callable=lambda e: [m.value for m in e],
        )
    )
    quantity: Mapped[Decimal] = mapped_column(Quantity)
    balance_after: Mapped[Decimal] = mapped_column(Quantity)
    unit_cost: Mapped[Decimal] = mapped_column(Cost, default=ZERO)
    reference: Mapped[str | None] = mapped_column(String(80), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    transfer_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    purchase_order_id: Mapped[int | None] = mapped_column(
        ForeignKey("purchase_orders.id", ondelete="SET NULL"), nullable=True
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)

    product: Mapped[Product] = relationship()
    warehouse: Mapped[Warehouse] = relationship()
    user: Mapped[User | None] = relationship()
