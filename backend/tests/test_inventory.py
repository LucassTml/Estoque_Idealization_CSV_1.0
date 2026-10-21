from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Product
from tests.conftest import fresh


def _entry(client, headers, product_id, warehouse_id, qty, cost=None):  # type: ignore[no-untyped-def]
    body = {"product_id": product_id, "warehouse_id": warehouse_id, "quantity": qty}
    if cost is not None:
        body["unit_cost"] = cost
    return client.post("/api/v1/stock/entries", headers=headers, json=body)


def test_entries_update_weighted_average_cost(
    client: TestClient, admin_headers: dict, catalog: dict, db: Session
) -> None:
    p, alm = catalog["product"], catalog["alm"]
    assert _entry(client, admin_headers, p.id, alm.id, 10, 5.00).status_code == 201
    assert _entry(client, admin_headers, p.id, alm.id, 30, 9.00).status_code == 201
    # (10 × 5 + 30 × 9) / 40 = 8
    detail = client.get(f"/api/v1/products/{p.id}", headers=admin_headers).json()
    assert detail["cost_price"] == 8.0
    assert detail["total_stock"] == 40.0
    assert detail["stock_value"] == 320.0


def test_exit_cannot_make_stock_negative(
    client: TestClient, admin_headers: dict, catalog: dict
) -> None:
    p, alm = catalog["product"], catalog["alm"]
    _entry(client, admin_headers, p.id, alm.id, 3)
    r = client.post(
        "/api/v1/stock/exits",
        headers=admin_headers,
        json={"product_id": p.id, "warehouse_id": alm.id, "quantity": 5},
    )
    assert r.status_code == 422
    assert r.json()["code"] == "insufficient_stock"


def test_transfer_moves_between_warehouses_and_keeps_total(
    client: TestClient, admin_headers: dict, catalog: dict
) -> None:
    p, alm, loja = catalog["product"], catalog["alm"], catalog["loja"]
    _entry(client, admin_headers, p.id, alm.id, 20)
    r = client.post(
        "/api/v1/stock/transfers",
        headers=admin_headers,
        json={
            "product_id": p.id,
            "from_warehouse_id": alm.id,
            "to_warehouse_id": loja.id,
            "quantity": 8,
        },
    )
    assert r.status_code == 201
    out, inbound = r.json()
    assert out["transfer_id"] == inbound["transfer_id"]
    assert (out["quantity"], inbound["quantity"]) == (-8.0, 8.0)

    detail = client.get(f"/api/v1/products/{p.id}", headers=admin_headers).json()
    by_wh = {s["warehouse_code"]: s["quantity"] for s in detail["stock"]}
    assert by_wh == {"ALM": 12.0, "LOJA": 8.0}
    assert detail["total_stock"] == 20.0


def test_transfer_to_same_warehouse_is_rejected(
    client: TestClient, admin_headers: dict, catalog: dict
) -> None:
    p, alm = catalog["product"], catalog["alm"]
    r = client.post(
        "/api/v1/stock/transfers",
        headers=admin_headers,
        json={
            "product_id": p.id,
            "from_warehouse_id": alm.id,
            "to_warehouse_id": alm.id,
            "quantity": 1,
        },
    )
    assert r.status_code == 422


def test_adjustment_records_difference(
    client: TestClient, admin_headers: dict, catalog: dict
) -> None:
    p, alm = catalog["product"], catalog["alm"]
    _entry(client, admin_headers, p.id, alm.id, 10)
    body = {"product_id": p.id, "warehouse_id": alm.id, "counted_quantity": 7, "notes": "quebra"}
    r = client.post("/api/v1/stock/adjustments", headers=admin_headers, json=body)
    assert r.json()["quantity"] == -3.0
    assert r.json()["balance_after"] == 7.0
    # contagem igual ao sistema não gera movimento
    same = client.post(
        "/api/v1/stock/adjustments", headers=admin_headers, json={**body, "counted_quantity": 7}
    )
    assert same.status_code == 200 and same.json() is None


def test_kardex_lists_movements_with_running_balance(
    client: TestClient, admin_headers: dict, catalog: dict
) -> None:
    p, alm = catalog["product"], catalog["alm"]
    _entry(client, admin_headers, p.id, alm.id, 10)
    client.post(
        "/api/v1/stock/exits",
        headers=admin_headers,
        json={"product_id": p.id, "warehouse_id": alm.id, "quantity": 4},
    )
    _entry(client, admin_headers, p.id, alm.id, 1)
    page = client.get(f"/api/v1/products/{p.id}/movements", headers=admin_headers).json()
    assert page["total"] == 3
    assert [m["balance_after"] for m in page["items"]] == [7.0, 6.0, 10.0]  # mais recente primeiro


def test_inactive_product_cannot_receive_stock(
    client: TestClient, admin_headers: dict, catalog: dict, db: Session
) -> None:
    p = db.get(Product, catalog["product"].id)
    p.is_active = False
    db.commit()
    r = _entry(client, admin_headers, p.id, catalog["alm"].id, 1)
    assert r.status_code == 422


def test_delete_product_with_history_only_deactivates(
    client: TestClient, admin_headers: dict, catalog: dict, db: Session
) -> None:
    p = catalog["product"]
    _entry(client, admin_headers, p.id, catalog["alm"].id, 1)
    assert client.delete(f"/api/v1/products/{p.id}", headers=admin_headers).status_code == 204
    fresh(db)
    assert db.get(Product, p.id).is_active is False


def test_duplicate_sku_returns_conflict(
    client: TestClient, admin_headers: dict, catalog: dict
) -> None:
    r = client.post(
        "/api/v1/products", headers=admin_headers, json={"sku": "p-001", "name": "Duplicado"}
    )
    assert r.status_code == 409


def test_product_list_filters_and_lookup(
    client: TestClient, admin_headers: dict, catalog: dict
) -> None:
    p, alm = catalog["product"], catalog["alm"]
    client.patch(
        f"/api/v1/products/{p.id}", headers=admin_headers, json={"barcode": "7891234567895"}
    )
    _entry(client, admin_headers, p.id, alm.id, 5)  # abaixo do mínimo (10)

    low = client.get("/api/v1/products?stock_status=low", headers=admin_headers).json()
    assert [i["sku"] for i in low["items"]] == ["P-001"]
    assert (
        client.get("/api/v1/products?stock_status=out", headers=admin_headers).json()["total"] == 0
    )
    assert client.get("/api/v1/products?q=teste", headers=admin_headers).json()["total"] == 1

    found = client.get("/api/v1/products/lookup?code=7891234567895", headers=admin_headers)
    assert found.status_code == 200 and found.json()["sku"] == "P-001"
    assert client.get("/api/v1/products/lookup?code=nada", headers=admin_headers).status_code == 404


def test_decimal_quantities_for_weighted_units(
    client: TestClient, admin_headers: dict, catalog: dict
) -> None:
    created = client.post(
        "/api/v1/products", headers=admin_headers, json={"sku": "CABO", "name": "Cabo", "unit": "m"}
    ).json()
    _entry(client, admin_headers, created["id"], catalog["alm"].id, 12.5)
    r = client.post(
        "/api/v1/stock/exits",
        headers=admin_headers,
        json={"product_id": created["id"], "warehouse_id": catalog["alm"].id, "quantity": 2.25},
    )
    assert r.json()["balance_after"] == float(Decimal("10.25"))
