# -*- mode: python ; coding: utf-8 -*-
# Build:  cd backend && uv run pyinstaller ../desktop/estoque.spec --noconfirm
# Pré-requisito: frontend compilado (cd frontend && npm run build).
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

ROOT = Path(SPECPATH).resolve().parent  # noqa: F821 (SPECPATH é injetado pelo PyInstaller)
BACKEND = ROOT / "backend"
FRONTEND_DIST = ROOT / "frontend" / "dist"
if not (FRONTEND_DIST / "index.html").exists():
    raise SystemExit("Compile o frontend antes: cd frontend && npm run build")

hiddenimports = [
    *collect_submodules("app", filter=lambda name: not name.startswith("app.migrations")),
    "sqlalchemy.dialects.sqlite",
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "apscheduler.schedulers.background",
    "apscheduler.triggers.cron",
    "apscheduler.executors.pool",
    "apscheduler.jobstores.memory",
]

datas = [
    (str(FRONTEND_DIST), "frontend_dist"),
    # As migrações são lidas do disco pelo Alembic (não podem virar bytecode empacotado).
    (str(BACKEND / "app" / "migrations"), "app/migrations"),
    *collect_data_files("tzdata"),
    *collect_data_files("fpdf"),
    *collect_data_files("barcode"),
]

a = Analysis(  # noqa: F821
    [str(ROOT / "desktop" / "launcher.py")],
    pathex=[str(BACKEND)],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["psycopg", "psycopg_binary", "tkinter", "pytest", "IPython", "matplotlib", "numpy"],
    noarchive=False,
)
pyz = PYZ(a.pure)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="EstoqueIdealization",
    console=True,  # a janela de console mostra o endereço e encerra o sistema ao fechar
    icon=str(ROOT / "desktop" / "icon.ico") if sys.platform == "win32" else None,
    upx=False,
)
