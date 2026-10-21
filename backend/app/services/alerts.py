"""Detecção de estoque baixo/zerado.

Um alerta só é criado quando o saldo total *cruza* o limite (estava acima e ficou abaixo),
evitando uma enxurrada de avisos a cada saída. Quando o saldo volta para cima do mínimo,
os alertas abertos são resolvidos automaticamente.

O envio externo (e-mail/Telegram) só acontece depois do commit da transação.
"""

from __future__ import annotations

import logging
import threading
from decimal import Decimal

from sqlalchemy import event, select, update
from sqlalchemy.orm import Session

from app.models import AlertEvent, AlertKind, Product
from app.models.base import ZERO, utcnow

logger = logging.getLogger(__name__)
PENDING_KEY = "pending_alert_ids"


def _fmt(value: Decimal) -> str:
    return f"{value.normalize():f}"


def evaluate_product(
    db: Session, product: Product, *, previous_total: Decimal
) -> AlertEvent | None:
    current = product.total_stock
    minimum = product.min_stock or ZERO

    if current > minimum and current > 0:
        db.execute(
            update(AlertEvent)
            .where(AlertEvent.product_id == product.id, AlertEvent.resolved_at.is_(None))
            .values(resolved_at=utcnow())
        )
        return None

    crossed_zero = previous_total > 0 and current <= 0
    crossed_min = minimum > 0 and previous_total > minimum and current <= minimum
    if not (crossed_zero or crossed_min):
        return None

    if current <= 0:
        kind = AlertKind.OUT_OF_STOCK
        message = f"{product.sku} — {product.name} está sem estoque."
    else:
        kind = AlertKind.LOW_STOCK
        message = (
            f"{product.sku} — {product.name} está abaixo do mínimo: "
            f"{_fmt(current)} {product.unit} (mínimo {_fmt(minimum)})."
        )
    alert = AlertEvent(product_id=product.id, kind=kind, message=message, channels=["app"])
    db.add(alert)
    db.flush()
    db.info.setdefault(PENDING_KEY, []).append(alert.id)
    return alert


def open_alerts(db: Session, limit: int = 50) -> list[AlertEvent]:
    stmt = (
        select(AlertEvent)
        .where(AlertEvent.resolved_at.is_(None))
        .order_by(AlertEvent.created_at.desc())
        .limit(limit)
    )
    return list(db.scalars(stmt))


# ----- Envio externo depois do commit -----------------------------------------------------------

_dispatch_enabled = True


def set_dispatch_enabled(enabled: bool) -> None:
    """Usado nos testes para não abrir threads de envio."""
    global _dispatch_enabled
    _dispatch_enabled = enabled


@event.listens_for(Session, "after_commit")
def _after_commit(session: Session) -> None:
    alert_ids = session.info.pop(PENDING_KEY, None)
    if alert_ids and _dispatch_enabled:
        from app.services.notifications import dispatch_alerts

        threading.Thread(target=dispatch_alerts, args=(alert_ids,), daemon=True).start()


@event.listens_for(Session, "after_rollback")
def _after_rollback(session: Session) -> None:
    session.info.pop(PENDING_KEY, None)
