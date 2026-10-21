# syntax=docker/dockerfile:1
# Imagem única: o FastAPI serve a API e o React compilado (mesma origem, sem CORS).

# ---------- 1. Build do frontend ----------
FROM node:24-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- 2. Dependências Python ----------
FROM python:3.13-slim AS backend-deps
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

# ---------- 3. Imagem final ----------
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/backend/.venv/bin:$PATH" \
    ENVIRONMENT=production \
    FRONTEND_DIST=/app/frontend/dist \
    DATA_DIR=/data \
    DATABASE_URL=sqlite:////data/estoque.db
RUN useradd --create-home --uid 1000 app && mkdir -p /data && chown app:app /data
WORKDIR /app/backend
COPY --from=backend-deps /app/backend/.venv ./.venv
COPY backend/app ./app
COPY --from=frontend /app/frontend/dist /app/frontend/dist
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", 8000)}/api/v1/health')"
# PORT é definido por plataformas como Render, Railway e Fly.io.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
