"""Configuração da aplicação, lida de variáveis de ambiente (ou de um arquivo .env)."""

from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_VERSION = "2.0.0"
INSECURE_DEFAULT_KEY = "dev-insecure-secret-key-change-me"


class Settings(BaseSettings):
    # Variáveis vazias (ex.: `ANTHROPIC_API_KEY=` no docker-compose) contam como não definidas.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_ignore_empty=True)

    app_name: str = "Estoque Idealization"
    environment: Literal["development", "production", "test", "desktop"] = "development"
    timezone: str = "America/Sao_Paulo"

    # Banco de dados: SQLite para uso local/portátil, PostgreSQL em produção.
    database_url: str = "sqlite:///./data/estoque.db"
    data_dir: Path = Path("./data")

    # Segurança
    secret_key: str = INSECURE_DEFAULT_KEY
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    login_max_attempts: int = 5
    login_window_seconds: int = 300

    # Frontend compilado (servido pela própria API em produção e no executável)
    frontend_dist: Path | None = None

    # Primeiro administrador criado automaticamente (opcional; senão usa a tela de setup)
    first_admin_email: str | None = None
    first_admin_password: str | None = None
    first_admin_name: str = "Administrador"

    # Modo demonstração: popula dados de exemplo e protege as contas demo
    demo_mode: bool = False

    # Assistente com IA (Claude)
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5-5"
    anthropic_effort: Literal["low", "medium", "high", "xhigh", "max"] = "medium"

    # Alertas externos
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_starttls: bool = True
    telegram_bot_token: str | None = None

    # Agendador interno (resumo diário) e gatilho externo protegido por token
    scheduler_enabled: bool = True
    cron_token: str | None = None

    @field_validator("database_url")
    @classmethod
    def normalize_postgres_url(cls, value: str) -> str:
        # Render, Neon, Heroku etc. entregam "postgres://"; o SQLAlchemy precisa do driver.
        if value.startswith("postgres://"):
            value = "postgresql://" + value.removeprefix("postgres://")
        if value.startswith("postgresql://"):
            value = "postgresql+psycopg://" + value.removeprefix("postgresql://")
        return value

    @model_validator(mode="after")
    def check_secret_key(self) -> Settings:
        if self.environment == "production" and self.secret_key == INSECURE_DEFAULT_KEY:
            raise ValueError("Defina SECRET_KEY em produção.")
        if self.environment == "desktop" and self.secret_key == INSECURE_DEFAULT_KEY:
            self.secret_key = _persistent_desktop_key(self.data_dir)
        return self

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def ai_enabled(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def email_enabled(self) -> bool:
        return bool(self.smtp_host and (self.smtp_from or self.smtp_user))

    @property
    def telegram_enabled(self) -> bool:
        return bool(self.telegram_bot_token)


def _persistent_desktop_key(data_dir: Path) -> str:
    """No executável portátil não há variável de ambiente: gera uma chave e guarda junto aos dados."""
    data_dir.mkdir(parents=True, exist_ok=True)
    key_file = data_dir / ".secret_key"
    if key_file.exists():
        return key_file.read_text(encoding="utf-8").strip()
    key = secrets.token_urlsafe(48)
    key_file.write_text(key, encoding="utf-8")
    return key


@lru_cache
def get_settings() -> Settings:
    return Settings()
