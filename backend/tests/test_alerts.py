from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AlertEvent, AlertKind
from app.services import notifications
from app.services.settings_store import AlertSettings, save_alert_settings
from tests.conftest import fresh


def _move(client, headers, catalog, kind, qty):  # type: ignore[no-untyped-def]
    return client.post(
        f"/api/v1/stock/{kind}",
        headers=headers,
        json={
            "product_id": catalog["product"].id,
            "warehouse_id": catalog["alm"].id,
            "quantity": qty,
        },
    )


def test_alert_only_when_crossing_minimum(
    client: TestClient, admin_headers: dict, catalog: dict, db: Session
) -> None:
    _move(client, admin_headers, catalog, "entries", 15)  # mínimo é 10
    assert db.scalars(select(AlertEvent)).all() == []

    _move(client, admin_headers, catalog, "exits", 6)  # 9: cruzou o mínimo
    _move(client, admin_headers, catalog, "exits", 2)  # 7: continua abaixo, sem novo alerta
    fresh(db)
    alerts = db.scalars(select(AlertEvent)).all()
    assert len(alerts) == 1 and alerts[0].kind == AlertKind.LOW_STOCK

    _move(client, admin_headers, catalog, "exits", 7)  # 0: escalona para "sem estoque"
    fresh(db)
    kinds = [a.kind for a in db.scalars(select(AlertEvent).order_by(AlertEvent.id))]
    assert kinds == [AlertKind.LOW_STOCK, AlertKind.OUT_OF_STOCK]

    count = client.get("/api/v1/alerts/count", headers=admin_headers).json()
    assert count["open"] == 2

    _move(client, admin_headers, catalog, "entries", 30)  # repôs: alertas resolvidos
    fresh(db)
    assert all(a.resolved_at is not None for a in db.scalars(select(AlertEvent)))
    assert client.get("/api/v1/alerts", headers=admin_headers).json() == []


def test_dispatch_sends_to_enabled_channels(monkeypatch, db: Session, catalog: dict) -> None:  # type: ignore[no-untyped-def]
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(
        notifications,
        "send_email",
        lambda to, subject, text, html=None: sent.append(("email", subject)),
    )
    monkeypatch.setattr(
        notifications, "send_telegram", lambda chat, text: sent.append(("telegram", chat))
    )
    save_alert_settings(
        db,
        AlertSettings(
            email_enabled=True,
            email_recipients=["compras@empresa.com"],
            telegram_enabled=True,
            telegram_chat_ids=["123", "456"],
        ),
    )
    alert = AlertEvent(
        product_id=catalog["product"].id,
        kind=AlertKind.LOW_STOCK,
        message="baixo",
        channels=["app"],
    )
    db.add(alert)
    db.commit()

    notifications.dispatch_alerts([alert.id])

    fresh(db)
    assert ("email", "[Minha Empresa] Alerta de estoque: P-001") in sent
    assert [s for s in sent if s[0] == "telegram"] == [("telegram", "123"), ("telegram", "456")]
    assert db.get(AlertEvent, alert.id).channels == ["app", "email", "telegram"]


def test_daily_summary_lists_low_items(db: Session, catalog: dict) -> None:
    from app.services import inventory

    inventory.register_entry(
        db,
        product_id=catalog["product"].id,
        warehouse_id=catalog["alm"].id,
        quantity=Decimal(3),
        user=None,
    )
    db.commit()
    subject, text, html = notifications.build_daily_summary(db)
    assert "Resumo do estoque" in subject
    assert "P-001" in text and "Abaixo do mínimo: 1" in text
    assert html.startswith("<pre")


def test_cron_endpoint_requires_token(client: TestClient, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from app.core.config import get_settings

    assert client.post("/api/v1/internal/daily-summary").status_code == 403
    monkeypatch.setattr(get_settings(), "cron_token", "segredo")
    monkeypatch.setattr(notifications, "send_daily_summary", lambda: ["email"])
    wrong = client.post("/api/v1/internal/daily-summary", headers={"X-Cron-Token": "x"})
    assert wrong.status_code == 403
    ok = client.post("/api/v1/internal/daily-summary", headers={"X-Cron-Token": "segredo"})
    assert ok.json() == {"delivered": ["email"]}


def test_demo_reset_requires_token_and_demo_mode(client: TestClient, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from app import seed
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "cron_token", "segredo")
    assert (
        client.post("/api/v1/internal/demo-reset", headers={"X-Cron-Token": "x"}).status_code == 403
    )
    not_demo = client.post("/api/v1/internal/demo-reset", headers={"X-Cron-Token": "segredo"})
    assert not_demo.status_code == 409

    calls: list[bool] = []
    monkeypatch.setattr(get_settings(), "demo_mode", True)
    monkeypatch.setattr(seed, "reset_demo", lambda: calls.append(True))
    ok = client.post("/api/v1/internal/demo-reset", headers={"X-Cron-Token": "segredo"})
    assert ok.json() == {"status": "ok"} and calls == [True]
