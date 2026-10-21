from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator
from decimal import Decimal
from pathlib import Path

# Configura o ambiente ANTES de importar a aplicação (o engine é criado na importação).
_tmp = Path(tempfile.mkdtemp(prefix="estoque-tests-"))
if not os.environ.get("DATABASE_URL"):  # no CI a matriz pode apontar para o PostgreSQL
    os.environ["DATABASE_URL"] = f"sqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["ENVIRONMENT"] = "test"
os.environ["SECRET_KEY"] = "test-secret-key-with-at-least-32-bytes!"
os.environ["SCHEDULER_ENABLED"] = "false"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["DEMO_MODE"] = "false"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.bootstrap import run_migrations
from app.core.database import SessionLocal, engine
from app.core.security import hash_password, login_rate_limiter
from app.main import app
from app.models import Base, Category, Product, Role, Supplier, User, Warehouse
from app.services import alerts

PASSWORD = "senha-segura-123"


@pytest.fixture(scope="session", autouse=True)
def _database() -> Iterator[None]:
    run_migrations()  # testa as migrações de verdade, não só o metadata
    alerts.set_dispatch_enabled(False)
    yield


@pytest.fixture(autouse=True)
def _clean_tables() -> Iterator[None]:
    yield
    login_rate_limiter._failures.clear()
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(text(f"DELETE FROM {table.name}"))


@pytest.fixture
def db() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def make_user(db: Session, role: Role = Role.ADMIN, email: str | None = None) -> User:
    user = User(
        name=f"Usuário {role.value}",
        email=email or f"{role.value}@teste.com",
        password_hash=hash_password(PASSWORD),
        role=role,
    )
    db.add(user)
    db.commit()
    return user


def login(client: TestClient, email: str, password: str = PASSWORD) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def admin_headers(client: TestClient, db: Session) -> dict[str, str]:
    user = make_user(db, Role.ADMIN)
    return login(client, user.email)


@pytest.fixture
def headers_for(client: TestClient, db: Session):  # type: ignore[no-untyped-def]
    def _make(role: Role) -> dict[str, str]:
        user = make_user(db, role, email=f"{role.value}-x@teste.com")
        return login(client, user.email)

    return _make


@pytest.fixture
def catalog(db: Session) -> dict[str, object]:
    """Dois depósitos, um fornecedor e um produto com mínimo 10."""
    alm = Warehouse(code="ALM", name="Almoxarifado")
    loja = Warehouse(code="LOJA", name="Loja")
    supplier = Supplier(name="Fornecedor Teste", lead_time_days=5)
    category = Category(name="Geral")
    db.add_all([alm, loja, supplier, category])
    db.flush()
    product = Product(
        sku="P-001",
        name="Produto teste",
        unit="UN",
        min_stock=Decimal(10),
        supplier_id=supplier.id,
        category_id=category.id,
    )
    db.add(product)
    db.commit()
    return {
        "alm": alm,
        "loja": loja,
        "supplier": supplier,
        "product": product,
        "category": category,
    }


def fresh(db: Session) -> None:
    """Encerra a transação de leitura (snapshot do SQLite em WAL) e descarta o cache da sessão."""
    db.rollback()
    db.expire_all()
