"""Tarefas de inicialização: migrações, primeiro administrador, dados de demonstração e agendador."""

from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.database import SessionLocal, engine
from app.core.security import hash_password
from app.models import AppSetting, Product, Role, User
from app.models.base import utcnow
from app.services.analytics import local_date, local_tz

logger = logging.getLogger(__name__)
MIGRATIONS_DIR = Path(__file__).parent / "migrations"
LAST_SUMMARY_KEY = "daily_summary_last_sent"


def run_migrations() -> None:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.set_main_option("sqlalchemy.url", get_settings().database_url.replace("%", "%%"))
    config.attributes["configure_logger"] = False
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")


def ensure_first_admin() -> None:
    settings = get_settings()
    if not (settings.first_admin_email and settings.first_admin_password):
        return
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(User)):
            return
        db.add(
            User(
                name=settings.first_admin_name,
                email=settings.first_admin_email.lower(),
                password_hash=hash_password(settings.first_admin_password),
                role=Role.ADMIN,
            )
        )
        db.commit()
        logger.info("Administrador inicial %s criado", settings.first_admin_email)


def ensure_demo_data() -> None:
    if not get_settings().demo_mode:
        return
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(Product)):
            return
    from app.seed import seed_demo

    logger.info("Modo demonstração: gerando dados de exemplo...")
    seed_demo()


def _daily_summary_job() -> None:
    from app.services import notifications
    from app.services.settings_store import get_alert_settings

    now = utcnow().astimezone(local_tz())
    with SessionLocal() as db:
        alert_settings = get_alert_settings(db)
        if (
            not alert_settings.daily_summary_enabled
            or now.hour != alert_settings.daily_summary_hour
        ):
            return
        marker = db.get(AppSetting, LAST_SUMMARY_KEY)
        today = local_date(utcnow()).isoformat()
        if marker and marker.value == today:
            return
        if marker:
            marker.value = today
        else:
            db.add(AppSetting(key=LAST_SUMMARY_KEY, value=today))
        db.commit()
    delivered = notifications.send_daily_summary()
    logger.info("Resumo diário enviado por: %s", delivered or "nenhum canal")


def start_scheduler() -> BackgroundScheduler | None:
    if not get_settings().scheduler_enabled:
        return None
    scheduler = BackgroundScheduler(timezone=str(local_tz()))
    scheduler.add_job(
        _daily_summary_job, "cron", minute=0, id="daily_summary", replace_existing=True
    )
    scheduler.start()
    return scheduler
