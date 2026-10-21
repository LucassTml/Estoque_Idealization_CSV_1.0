"""Sobe a aplicação com um banco de demonstração novo, para os testes E2E (Playwright).

Uso: uv run python -m scripts.e2e_server [porta]
"""

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
DATA = BACKEND / "data" / "e2e"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8001

for leftover in DATA.glob("e2e.db*"):
    leftover.unlink()
DATA.mkdir(parents=True, exist_ok=True)

os.environ.update(
    {
        "DATABASE_URL": f"sqlite:///{(DATA / 'e2e.db').as_posix()}",
        "DATA_DIR": DATA.as_posix(),
        "DEMO_MODE": "true",
        "SCHEDULER_ENABLED": "false",
        "FRONTEND_DIST": (BACKEND.parent / "frontend" / "dist").as_posix(),
        "SECRET_KEY": "e2e-secret-key-not-for-production-use-0123456789",
        "LOGIN_MAX_ATTEMPTS": "100",
    }
)

import uvicorn  # noqa: E402

uvicorn.run("app.main:app", host="127.0.0.1", port=PORT, log_level="warning")
