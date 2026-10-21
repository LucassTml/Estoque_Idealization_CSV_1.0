"""Envio de alertas e do resumo diário por e-mail (SMTP) e Telegram (Bot API)."""

from __future__ import annotations

import html
import logging
import smtplib
from datetime import timedelta
from email.message import EmailMessage

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models import (
    AlertEvent,
    MovementType,
    Product,
    PurchaseOrder,
    PurchaseOrderStatus,
    StockMovement,
)
from app.models.base import utcnow
from app.services import analytics, forecasting
from app.services.settings_store import AlertSettings, get_alert_settings, get_general_settings

logger = logging.getLogger(__name__)


class NotificationError(RuntimeError):
    pass


def send_email(
    recipients: list[str], subject: str, text: str, html_body: str | None = None
) -> None:
    settings = get_settings()
    if not settings.email_enabled:
        raise NotificationError("SMTP não configurado (defina SMTP_HOST e SMTP_FROM).")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from or settings.smtp_user
    message["To"] = ", ".join(recipients)
    message.set_content(text)
    if html_body:
        message.add_alternative(html_body, subtype="html")
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:  # type: ignore[arg-type]
        if settings.smtp_starttls:
            smtp.starttls()
        if settings.smtp_user and settings.smtp_password:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(message)


def send_telegram(chat_id: str, text: str) -> None:
    settings = get_settings()
    if not settings.telegram_enabled:
        raise NotificationError("Telegram não configurado (defina TELEGRAM_BOT_TOKEN).")
    response = httpx.post(
        f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
        json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
        timeout=15,
    )
    if response.status_code != 200:
        raise NotificationError(f"Telegram respondeu {response.status_code}: {response.text[:200]}")


def broadcast(
    alert_settings: AlertSettings, subject: str, text: str, html_body: str | None = None
) -> list[str]:
    """Envia para todos os canais habilitados e devolve os que funcionaram."""
    delivered: list[str] = []
    if alert_settings.email_enabled and alert_settings.email_recipients:
        try:
            send_email([str(r) for r in alert_settings.email_recipients], subject, text, html_body)
            delivered.append("email")
        except Exception:
            logger.exception("Falha ao enviar e-mail")
    if alert_settings.telegram_enabled and alert_settings.telegram_chat_ids:
        sent_any = False
        for chat_id in alert_settings.telegram_chat_ids:
            try:
                send_telegram(chat_id, f"<b>{html.escape(subject)}</b>\n{html.escape(text)}")
                sent_any = True
            except Exception:
                logger.exception("Falha ao enviar Telegram para %s", chat_id)
        if sent_any:
            delivered.append("telegram")
    return delivered


def dispatch_alerts(alert_ids: list[int]) -> None:
    with SessionLocal() as db:
        alert_settings = get_alert_settings(db)
        if not alert_settings.low_stock_enabled:
            return
        company = get_general_settings(db).company_name
        for alert in db.scalars(select(AlertEvent).where(AlertEvent.id.in_(alert_ids))):
            subject = f"[{company}] Alerta de estoque: {alert.product.sku}"
            delivered = broadcast(alert_settings, subject, alert.message)
            if delivered:
                alert.channels = [*alert.channels, *delivered]
        db.commit()


# ----- Resumo diário ------------------------------------------------------------------------------


def build_daily_summary(db: Session) -> tuple[str, str, str]:
    company = get_general_settings(db).company_name
    summary = analytics.dashboard_summary(db)
    since = utcnow() - timedelta(days=1)
    moves = dict(
        db.execute(
            select(StockMovement.type, func.count())
            .where(StockMovement.created_at >= since)
            .group_by(StockMovement.type)
        ).all()
    )
    low = db.scalars(
        select(Product).where(Product.is_active.is_(True), Product.min_stock > 0)
    ).all()
    low = [p for p in low if p.is_below_min][:15]
    overdue = db.scalars(
        select(PurchaseOrder).where(
            PurchaseOrder.status.in_(
                [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED]
            ),
            PurchaseOrder.expected_date < utcnow().date(),
        )
    ).all()
    suggestions = forecasting.replenishment_suggestions(db)[:10]

    date_label = utcnow().strftime("%d/%m/%Y")
    subject = f"[{company}] Resumo do estoque — {date_label}"
    lines = [
        f"Resumo de {date_label}",
        f"Produtos ativos: {summary['active_products']}",
        f"Valor em estoque: R$ {summary['stock_value']:,.2f}",
        f"Abaixo do mínimo: {summary['below_min_count']}  |  Zerados: {summary['out_of_stock_count']}",
        f"Movimentações nas últimas 24h: {sum(moves.values())} "
        f"(entradas {moves.get(MovementType.ENTRY, 0) + moves.get(MovementType.RECEIPT, 0)}, "
        f"saídas {moves.get(MovementType.EXIT, 0)})",
    ]
    if low:
        lines.append("")
        lines.append("Itens abaixo do mínimo:")
        lines += [
            f"  • {p.sku} {p.name}: {p.total_stock.normalize():f} / mín {p.min_stock.normalize():f}"
            for p in low
        ]
    if overdue:
        lines.append("")
        lines.append("Pedidos de compra atrasados:")
        lines += [
            f"  • {po.number} — {po.supplier.name} (previsto {po.expected_date:%d/%m})"
            for po in overdue
        ]
    if suggestions:
        lines.append("")
        lines.append("Sugestões de reposição:")
        lines += [
            f"  • {s['sku']} {s['name']}: comprar {s['suggested_quantity']:g} "
            f"(acaba em ~{s['days_until_stockout']:.0f} dias)"
            if s["days_until_stockout"] is not None
            else f"  • {s['sku']} {s['name']}: comprar {s['suggested_quantity']:g}"
            for s in suggestions
        ]
    text = "\n".join(lines)
    html_body = (
        "<pre style='font-family:system-ui,sans-serif;font-size:14px'>"
        + html.escape(text)
        + "</pre>"
    )
    return subject, text, html_body


def send_daily_summary() -> list[str]:
    with SessionLocal() as db:
        alert_settings = get_alert_settings(db)
        if not alert_settings.daily_summary_enabled:
            return []
        subject, text, html_body = build_daily_summary(db)
        return broadcast(alert_settings, subject, text, html_body)
