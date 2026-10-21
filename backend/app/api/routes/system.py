"""Alertas, configurações, auditoria, assistente com IA e metadados do sistema."""

from __future__ import annotations

import secrets
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import joinedload

from app.api.deps import DB, Admin, PageParams, Viewer, client_ip
from app.core.config import APP_VERSION, get_settings
from app.core.errors import BusinessRuleError
from app.models import AlertEvent, AlertKind, AuditLog
from app.models.base import utcnow
from app.schemas.common import IdName, ORMModel, Page
from app.schemas.reports import AlertCount, AssistantStatus
from app.services import alerts, assistant, audit, notifications
from app.services.settings_store import (
    AlertSettings,
    GeneralSettings,
    get_alert_settings,
    get_general_settings,
    save_alert_settings,
    save_general_settings,
)

router = APIRouter(tags=["Sistema"])


class MetaOut(BaseModel):
    app_name: str
    version: str
    environment: str
    demo_mode: bool
    features: dict[str, bool]
    company_name: str


class AlertOut(ORMModel):
    id: int
    kind: AlertKind
    message: str
    channels: list[str]
    created_at: datetime
    resolved_at: datetime | None
    acknowledged_at: datetime | None
    product: IdName


class AuditOut(ORMModel):
    id: int
    action: str
    entity_type: str
    entity_id: str | None
    summary: str
    changes: dict[str, Any] | None
    ip_address: str | None
    created_at: datetime
    user: IdName | None


class ChannelStatus(BaseModel):
    email_configured: bool
    telegram_configured: bool


class AlertSettingsOut(AlertSettings):
    channels: ChannelStatus


@router.get("/health", tags=["Sistema"])
def health(db: DB) -> dict[str, str]:
    db.execute(select(1))
    return {"status": "ok", "version": APP_VERSION}


@router.get("/meta", response_model=MetaOut)
def meta(db: DB) -> MetaOut:
    settings = get_settings()
    return MetaOut(
        app_name=settings.app_name,
        version=APP_VERSION,
        environment=settings.environment,
        demo_mode=settings.demo_mode,
        features={
            "assistant": settings.ai_enabled,
            "email": settings.email_enabled,
            "telegram": settings.telegram_enabled,
        },
        company_name=get_general_settings(db).company_name,
    )


# ---------- Alertas ----------
@router.get("/alerts", response_model=list[AlertOut])
def list_alerts(
    db: DB,
    _: Viewer,
    include_resolved: bool = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[AlertEvent]:
    stmt = (
        select(AlertEvent)
        .options(joinedload(AlertEvent.product))
        .order_by(AlertEvent.created_at.desc())
    )
    if not include_resolved:
        stmt = stmt.where(AlertEvent.resolved_at.is_(None))
    return list(db.scalars(stmt.limit(limit)))


@router.get("/alerts/count", response_model=AlertCount)
def alerts_count(db: DB, _: Viewer) -> dict[str, int]:
    unread = db.scalar(
        select(func.count()).where(
            AlertEvent.resolved_at.is_(None), AlertEvent.acknowledged_at.is_(None)
        )
    )
    open_ = db.scalar(select(func.count()).where(AlertEvent.resolved_at.is_(None)))
    return {"unread": unread or 0, "open": open_ or 0}


@router.post("/alerts/acknowledge", status_code=status.HTTP_204_NO_CONTENT)
def acknowledge_alerts(db: DB, _: Viewer) -> None:
    for alert in alerts.open_alerts(db, limit=500):
        alert.acknowledged_at = alert.acknowledged_at or utcnow()
    db.commit()


# ---------- Configurações ----------
@router.get("/settings/general", response_model=GeneralSettings)
def read_general(db: DB, _: Viewer) -> GeneralSettings:
    return get_general_settings(db)


@router.put("/settings/general", response_model=GeneralSettings)
def write_general(
    payload: GeneralSettings, db: DB, user: Admin, request: Request
) -> GeneralSettings:
    changes = audit.diff(get_general_settings(db), payload.model_dump())
    save_general_settings(db, payload)
    audit.record(
        db,
        user=user,
        action="update",
        entity_type="settings",
        entity_id="general",
        summary="Configurações gerais alteradas",
        changes=changes,
        ip_address=client_ip(request),
    )
    db.commit()
    return payload


def _alert_settings_out(value: AlertSettings) -> AlertSettingsOut:
    settings = get_settings()
    return AlertSettingsOut(
        **value.model_dump(),
        channels=ChannelStatus(
            email_configured=settings.email_enabled, telegram_configured=settings.telegram_enabled
        ),
    )


@router.get("/settings/alerts", response_model=AlertSettingsOut)
def read_alert_settings(db: DB, _: Admin) -> AlertSettingsOut:
    return _alert_settings_out(get_alert_settings(db))


@router.put("/settings/alerts", response_model=AlertSettingsOut)
def write_alert_settings(
    payload: AlertSettings, db: DB, user: Admin, request: Request
) -> AlertSettingsOut:
    save_alert_settings(db, payload)
    audit.record(
        db,
        user=user,
        action="update",
        entity_type="settings",
        entity_id="alerts",
        summary="Configurações de alertas alteradas",
        ip_address=client_ip(request),
    )
    db.commit()
    return _alert_settings_out(payload)


@router.post("/settings/alerts/test")
def test_alerts(db: DB, _: Admin) -> dict[str, list[str]]:
    """Envia uma mensagem de teste para todos os canais habilitados."""
    alert_settings = get_alert_settings(db)
    if not (alert_settings.email_enabled or alert_settings.telegram_enabled):
        raise BusinessRuleError("Habilite e-mail ou Telegram antes de testar.")
    company = get_general_settings(db).company_name
    delivered = notifications.broadcast(
        alert_settings,
        f"[{company}] Teste de alertas",
        "Se você recebeu esta mensagem, os alertas do Estoque Idealization estão funcionando.",
    )
    return {"delivered": delivered}


@router.post("/settings/alerts/summary-preview")
def summary_preview(db: DB, _: Admin) -> dict[str, str]:
    subject, text, _html = notifications.build_daily_summary(db)
    return {"subject": subject, "text": text}


# ---------- Auditoria ----------
@router.get("/audit", response_model=Page[AuditOut])
def list_audit(
    db: DB,
    _: Admin,
    page: PageParams,
    entity_type: str | None = None,
    user_id: int | None = None,
    action: str | None = None,
) -> Page[AuditOut]:
    stmt = select(AuditLog)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.options(joinedload(AuditLog.user))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset(page.offset)
        .limit(page.page_size)
    ).all()
    return Page[AuditOut].build(
        [AuditOut.model_validate(r) for r in rows], total, page.page, page.page_size
    )


# ---------- Assistente com IA ----------
@router.get("/assistant/status", response_model=AssistantStatus)
def assistant_status(_: Viewer) -> dict[str, Any]:
    settings = get_settings()
    return {
        "enabled": settings.ai_enabled,
        "model": settings.anthropic_model if settings.ai_enabled else None,
    }


@router.post("/assistant/chat", response_model=assistant.ChatResponse)
def assistant_chat(payload: assistant.ChatRequest, db: DB, _: Viewer) -> assistant.ChatResponse:
    return assistant.chat(db, payload)


# ---------- Gatilhos externos (cron do GitHub Actions no ambiente online) ----------
def _check_cron_token(token: str | None) -> None:
    expected = get_settings().cron_token
    if not expected or not token or not secrets.compare_digest(expected, token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token inválido.")


@router.post("/internal/daily-summary", include_in_schema=False)
def trigger_daily_summary(
    x_cron_token: Annotated[str | None, Header()] = None,
) -> dict[str, list[str]]:
    """Para hospedagens que "dormem" (ex.: plano grátis), um cron externo pode chamar este endpoint."""
    _check_cron_token(x_cron_token)
    return {"delivered": notifications.send_daily_summary()}


@router.post("/internal/demo-reset", include_in_schema=False)
def trigger_demo_reset(x_cron_token: Annotated[str | None, Header()] = None) -> dict[str, str]:
    """Recria os dados de demonstração (só no modo demo), desfazendo o que os visitantes alteraram."""
    _check_cron_token(x_cron_token)
    if not get_settings().demo_mode:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Disponível apenas no modo demonstração."
        )
    from app.seed import reset_demo

    reset_demo()
    return {"status": "ok"}
