from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Role
from tests.conftest import PASSWORD, login, make_user


def test_first_run_setup_creates_admin_once(client: TestClient) -> None:
    assert client.get("/api/v1/auth/setup-status").json()["needs_setup"] is True

    payload = {"name": "Maria", "email": "maria@empresa.com", "password": "uma-senha-forte"}
    response = client.post("/api/v1/auth/setup", json=payload)
    assert response.status_code == 201
    assert response.json()["user"]["role"] == "admin"
    assert client.get("/api/v1/auth/setup-status").json()["needs_setup"] is False

    again = client.post("/api/v1/auth/setup", json={**payload, "email": "outro@empresa.com"})
    assert again.status_code == 403


def test_passwords_are_hashed_with_argon2(db: Session) -> None:
    user = make_user(db)
    assert user.password_hash.startswith("$argon2")
    assert PASSWORD not in user.password_hash


def test_login_and_me(client: TestClient, db: Session) -> None:
    make_user(db, Role.OPERATOR, email="op@teste.com")
    headers = login(client, "OP@teste.com")  # e-mail sem diferenciar maiúsculas
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == "op@teste.com"


def test_wrong_password_and_rate_limit(client: TestClient, db: Session) -> None:
    make_user(db, email="alvo@teste.com")
    for _ in range(5):
        r = client.post(
            "/api/v1/auth/login", json={"email": "alvo@teste.com", "password": "errada"}
        )
        assert r.status_code == 401
    blocked = client.post(
        "/api/v1/auth/login", json={"email": "alvo@teste.com", "password": PASSWORD}
    )
    assert blocked.status_code == 429


def test_requires_authentication(client: TestClient) -> None:
    assert client.get("/api/v1/products").status_code == 401
    bad = client.get("/api/v1/products", headers={"Authorization": "Bearer token-invalido"})
    assert bad.status_code == 401


def test_refresh_token_rotation_and_reuse_detection(client: TestClient, db: Session) -> None:
    make_user(db, email="rot@teste.com")
    client.post("/api/v1/auth/login", json={"email": "rot@teste.com", "password": PASSWORD})
    first = client.cookies.get("refresh_token")
    assert first

    refreshed = client.post("/api/v1/auth/refresh")
    assert refreshed.status_code == 200
    second = client.cookies.get("refresh_token")
    assert second and second != first

    # Reusar o token antigo derruba todas as sessões do usuário
    client.cookies.set("refresh_token", first, path="/api/v1/auth")
    assert client.post("/api/v1/auth/refresh").status_code == 401
    client.cookies.set("refresh_token", second, path="/api/v1/auth")
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_logout_revokes_refresh_token(client: TestClient, db: Session) -> None:
    make_user(db, email="sai@teste.com")
    client.post("/api/v1/auth/login", json={"email": "sai@teste.com", "password": PASSWORD})
    token = client.cookies.get("refresh_token")
    assert client.post("/api/v1/auth/logout").status_code == 204
    client.cookies.set("refresh_token", token, path="/api/v1/auth")
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_change_password(client: TestClient, db: Session) -> None:
    make_user(db, email="troca@teste.com")
    headers = login(client, "troca@teste.com")
    wrong = client.patch(
        "/api/v1/auth/me",
        headers=headers,
        json={"current_password": "x", "new_password": "nova-senha-123"},
    )
    assert wrong.status_code == 422
    ok = client.patch(
        "/api/v1/auth/me",
        headers=headers,
        json={"current_password": PASSWORD, "new_password": "nova-senha-123"},
    )
    assert ok.status_code == 200
    login(client, "troca@teste.com", "nova-senha-123")


def test_admin_cannot_demote_last_admin(client: TestClient, admin_headers: dict[str, str]) -> None:
    me = client.get("/api/v1/auth/me", headers=admin_headers).json()
    r = client.patch(f"/api/v1/users/{me['id']}", headers=admin_headers, json={"role": "viewer"})
    assert r.status_code == 422
