"""Testa o loop de ferramentas do assistente com um cliente Claude falso (sem rede)."""

from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.services import assistant, inventory


class FakeMessages:
    def __init__(self, responses: list[SimpleNamespace]) -> None:
        self.responses = responses
        self.calls: list[dict] = []

    def create(self, **kwargs):  # type: ignore[no-untyped-def]
        self.calls.append(kwargs)
        return self.responses.pop(0)


def _client(responses: list[SimpleNamespace]) -> SimpleNamespace:
    return SimpleNamespace(beta=SimpleNamespace(messages=FakeMessages(responses)))


def _text(text: str) -> SimpleNamespace:
    return SimpleNamespace(type="text", text=text)


def test_tool_loop_executes_read_only_tools(db: Session, catalog: dict) -> None:
    inventory.register_entry(
        db,
        product_id=catalog["product"].id,
        warehouse_id=catalog["alm"].id,
        quantity=Decimal(4),
        user=None,
    )
    db.commit()
    fake = _client(
        [
            SimpleNamespace(
                stop_reason="tool_use",
                model="claude-test",
                content=[
                    _text("Vou verificar."),
                    SimpleNamespace(type="tool_use", id="t1", name="low_stock", input={"limit": 5}),
                    SimpleNamespace(
                        type="tool_use", id="t2", name="get_product", input={"sku": "p-001"}
                    ),
                ],
            ),
            SimpleNamespace(
                stop_reason="end_turn",
                model="claude-test",
                content=[_text("1 item abaixo do mínimo.")],
            ),
        ]
    )
    request = assistant.ChatRequest(messages=[{"role": "user", "content": "O que está acabando?"}])
    response = assistant.chat(db, request, client=fake)

    assert response.reply == "1 item abaixo do mínimo."
    assert [t.name for t in response.tools_used] == ["low_stock", "get_product"]
    assert all(t.ok for t in response.tools_used)

    second_call = fake.beta.messages.calls[1]
    results = second_call["messages"][-1]["content"]
    assert [r["tool_use_id"] for r in results] == [
        "t1",
        "t2",
    ]  # todos os resultados numa mensagem só
    assert '"P-001"' in results[0]["content"]
    assert second_call["fallbacks"] == "default"
    assert second_call["system"] == assistant.SYSTEM_PROMPT  # prompt fixo (cacheável)


def test_invalid_tool_input_is_reported_as_error(db: Session) -> None:
    fake = _client(
        [
            SimpleNamespace(
                stop_reason="tool_use",
                model="m",
                content=[
                    SimpleNamespace(
                        type="tool_use", id="t1", name="abc_curve", input={"days": 9999}
                    )
                ],
            ),
            SimpleNamespace(stop_reason="end_turn", model="m", content=[_text("ok")]),
        ]
    )
    response = assistant.chat(
        db, assistant.ChatRequest(messages=[{"role": "user", "content": "abc"}]), client=fake
    )
    assert response.tools_used[0].ok is False
    result = fake.beta.messages.calls[1]["messages"][-1]["content"][0]
    assert result["is_error"] is True


def test_refusal_is_handled(db: Session) -> None:
    fake = _client([SimpleNamespace(stop_reason="refusal", model="m", content=[])])
    response = assistant.chat(
        db, assistant.ChatRequest(messages=[{"role": "user", "content": "?"}]), client=fake
    )
    assert response.stop_reason == "refusal"
    assert response.reply


def test_endpoint_returns_503_without_api_key(client: TestClient, admin_headers: dict) -> None:
    status = client.get("/api/v1/assistant/status", headers=admin_headers).json()
    assert status["enabled"] is False
    r = client.post(
        "/api/v1/assistant/chat",
        headers=admin_headers,
        json={"messages": [{"role": "user", "content": "oi"}]},
    )
    assert r.status_code == 503
    assert r.json()["code"] == "ai_disabled"


def test_conversation_must_end_with_user(db: Session) -> None:
    with pytest.raises(assistant.AppError):
        assistant.chat(
            db,
            assistant.ChatRequest(
                messages=[
                    {"role": "user", "content": "oi"},
                    {"role": "assistant", "content": "olá"},
                ]
            ),
            client=_client([]),
        )
