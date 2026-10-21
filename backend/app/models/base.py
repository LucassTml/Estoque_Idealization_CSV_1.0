from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import DateTime, MetaData, Numeric, TypeDecorator
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Nomes previsíveis para constraints: necessários para o Alembic alterar tabelas no SQLite.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


_clock_override: datetime | None = None


def utcnow() -> datetime:
    return _clock_override or datetime.now(UTC)


def set_clock(moment: datetime | None) -> None:
    """Fixa o "agora" da aplicação (usado para gerar histórico de demonstração e nos testes)."""
    global _clock_override
    _clock_override = moment


class UTCDateTime(TypeDecorator[datetime]):
    """Sempre grava em UTC e devolve datetimes com fuso, inclusive no SQLite (que não guarda fuso)."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):  # type: ignore[no-untyped-def]
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    def process_result_value(self, value: datetime | None, dialect):  # type: ignore[no-untyped-def]
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value


Quantity = Numeric(14, 3)
Cost = Numeric(14, 4)
Price = Numeric(12, 2)
ZERO = Decimal("0")


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False
    )
