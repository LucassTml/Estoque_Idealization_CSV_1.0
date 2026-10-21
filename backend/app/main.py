"""Ponto de entrada da API FastAPI."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import bootstrap
from app.api.routes import (
    auth,
    catalog,
    products,
    purchase_orders,
    reports,
    stock,
    system,
    tools,
    users,
)
from app.core.config import APP_VERSION, get_settings
from app.core.errors import register_exception_handlers

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

DESCRIPTION = """
API do **Estoque Idealization** — gestão de estoque completa.

* Produtos, categorias, fornecedores e depósitos
* Livro de movimentações (entradas, saídas, transferências, ajustes) com custo médio ponderado
* Pedidos de compra com recebimento parcial
* Dashboard, curva ABC, giro de estoque e previsão de demanda (Holt / Croston)
* Etiquetas com código de barras e QR Code, importação/exportação CSV e Excel
* Assistente com IA (Claude) e alertas por e-mail/Telegram

Autentique-se pelo botão **Authorize** (usuário = e-mail).
"""


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    scheduler = None
    if settings.environment != "test":
        bootstrap.run_migrations()
        bootstrap.ensure_first_admin()
        bootstrap.ensure_demo_data()
        scheduler = bootstrap.start_scheduler()
    yield
    if scheduler:
        scheduler.shutdown(wait=False)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=APP_VERSION,
        description=DESCRIPTION,
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )
    register_exception_handlers(app)

    if settings.environment in {"development", "test"}:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(self), microphone=()")
        return response

    api = APIRouter(prefix="/api/v1")
    for module in (auth, users, catalog, products, stock, purchase_orders, reports, tools, system):
        api.include_router(module.router)
    app.include_router(api)

    _mount_frontend(app, settings.frontend_dist)
    return app


def _mount_frontend(app: FastAPI, dist: Path | None) -> None:
    """Serve o React compilado e devolve index.html para as rotas do SPA."""
    if dist is None or not (dist / "index.html").exists():
        return
    index = dist / "index.html"
    if (dist / "assets").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):  # type: ignore[no-untyped-def]
        if path.startswith("api/"):
            return JSONResponse({"detail": "Não encontrado."}, status_code=404)
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(dist.resolve()):
            return FileResponse(candidate)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


app = create_app()
