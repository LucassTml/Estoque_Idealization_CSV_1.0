"""Trilha de auditoria: quem fez o quê, quando e o que mudou."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog, User


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    return value


def diff(obj: Any, updates: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Compara os valores atuais de `obj` com `updates` e devolve só o que mudou."""
    changes: dict[str, dict[str, Any]] = {}
    for field, new in updates.items():
        old = getattr(obj, field, None)
        if old != new:
            changes[field] = {"from": _jsonable(old), "to": _jsonable(new)}
    return changes


def record(
    db: Session,
    *,
    user: User | None,
    action: str,
    entity_type: str,
    entity_id: Any = None,
    summary: str,
    changes: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            summary=summary[:255],
            changes=changes or None,
            ip_address=ip_address,
        )
    )
