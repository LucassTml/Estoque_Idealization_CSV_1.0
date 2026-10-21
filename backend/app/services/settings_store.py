"""Configurações editáveis pela interface, guardadas na tabela app_settings."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.models import AppSetting

ALERTS_KEY = "alerts"
GENERAL_KEY = "general"


class AlertSettings(BaseModel):
    low_stock_enabled: bool = True
    email_enabled: bool = False
    email_recipients: list[EmailStr] = Field(default_factory=list)
    telegram_enabled: bool = False
    telegram_chat_ids: list[str] = Field(default_factory=list)
    daily_summary_enabled: bool = False
    daily_summary_hour: int = Field(default=8, ge=0, le=23)


class GeneralSettings(BaseModel):
    company_name: str = Field(default="Minha Empresa", max_length=120)
    forecast_horizon_days: int = Field(default=30, ge=7, le=180)
    # Nível de serviço usado no estoque de segurança (0,95 → z ≈ 1,64).
    service_level: float = Field(default=0.95, ge=0.5, le=0.999)


def _load[M: BaseModel](db: Session, key: str, model: type[M]) -> M:
    row = db.get(AppSetting, key)
    return model.model_validate(row.value) if row else model()


def _save(db: Session, key: str, value: BaseModel) -> None:
    row = db.get(AppSetting, key)
    data = value.model_dump(mode="json")
    if row is None:
        db.add(AppSetting(key=key, value=data))
    else:
        row.value = data


def get_alert_settings(db: Session) -> AlertSettings:
    return _load(db, ALERTS_KEY, AlertSettings)


def save_alert_settings(db: Session, value: AlertSettings) -> None:
    _save(db, ALERTS_KEY, value)


def get_general_settings(db: Session) -> GeneralSettings:
    return _load(db, GENERAL_KEY, GeneralSettings)


def save_general_settings(db: Session, value: GeneralSettings) -> None:
    _save(db, GENERAL_KEY, value)
