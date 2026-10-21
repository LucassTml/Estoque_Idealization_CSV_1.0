"""Gera backend/openapi.json (fonte dos tipos TypeScript do frontend).

Uso: uv run python -m scripts.export_openapi
"""

import json
import os
from pathlib import Path

os.environ.setdefault("ENVIRONMENT", "test")

from app.main import app

target = Path(__file__).resolve().parents[1] / "openapi.json"
content = json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n"
target.write_text(content, encoding="utf-8", newline="\n")  # LF em qualquer SO (o CI compara)
print(f"OpenAPI salvo em {target}")
