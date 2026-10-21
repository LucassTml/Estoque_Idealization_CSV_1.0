from fastapi.testclient import TestClient


def _create_order(client, headers, catalog, qty=10, cost=4.0):  # type: ignore[no-untyped-def]
    return client.post(
        "/api/v1/purchase-orders",
        headers=headers,
        json={
            "supplier_id": catalog["supplier"].id,
            "warehouse_id": catalog["alm"].id,
            "items": [
                {"product_id": catalog["product"].id, "quantity_ordered": qty, "unit_cost": cost}
            ],
        },
    )


def test_full_purchase_cycle_with_partial_receipt(
    client: TestClient, admin_headers: dict, catalog: dict
) -> None:
    order = _create_order(client, admin_headers, catalog).json()
    assert order["status"] == "draft"
    assert order["number"].startswith("PC-")
    assert order["total"] == 40.0
    item_id = order["items"][0]["id"]

    # rascunho não pode ser recebido
    early = client.post(
        f"/api/v1/purchase-orders/{order['id']}/receive",
        headers=admin_headers,
        json={"items": [{"item_id": item_id, "quantity": 1}]},
    )
    assert early.status_code == 422

    submitted = client.post(
        f"/api/v1/purchase-orders/{order['id']}/submit", headers=admin_headers
    ).json()
    assert submitted["status"] == "ordered" and submitted["ordered_at"]

    partial = client.post(
        f"/api/v1/purchase-orders/{order['id']}/receive",
        headers=admin_headers,
        json={"items": [{"item_id": item_id, "quantity": 4}]},
    ).json()
    assert partial["status"] == "partially_received"
    assert partial["items"][0]["quantity_pending"] == 6.0

    too_much = client.post(
        f"/api/v1/purchase-orders/{order['id']}/receive",
        headers=admin_headers,
        json={"items": [{"item_id": item_id, "quantity": 7}]},
    )
    assert too_much.status_code == 422

    done = client.post(
        f"/api/v1/purchase-orders/{order['id']}/receive",
        headers=admin_headers,
        json={"items": [{"item_id": item_id, "quantity": 6, "unit_cost": 5.0}]},
    ).json()
    assert done["status"] == "received" and done["received_at"]

    product = client.get(f"/api/v1/products/{catalog['product'].id}", headers=admin_headers).json()
    assert product["total_stock"] == 10.0
    assert product["cost_price"] == 4.6  # (4 × 4 + 6 × 5) / 10

    movements = client.get(
        f"/api/v1/stock/movements?type=receipt&product_id={catalog['product'].id}",
        headers=admin_headers,
    ).json()
    assert movements["total"] == 2
    assert {m["reference"] for m in movements["items"]} == {order["number"]}


def test_only_drafts_are_editable_and_cancel_rules(
    client: TestClient, admin_headers: dict, catalog: dict
) -> None:
    order = _create_order(client, admin_headers, catalog).json()
    edited = client.patch(
        f"/api/v1/purchase-orders/{order['id']}",
        headers=admin_headers,
        json={
            "notes": "Urgente",
            "items": [{"product_id": catalog["product"].id, "quantity_ordered": 3, "unit_cost": 2}],
        },
    ).json()
    assert edited["notes"] == "Urgente" and edited["total"] == 6.0

    client.post(f"/api/v1/purchase-orders/{order['id']}/submit", headers=admin_headers)
    locked = client.patch(
        f"/api/v1/purchase-orders/{order['id']}", headers=admin_headers, json={"notes": "x"}
    )
    assert locked.status_code == 422

    item_id = edited["items"][0]["id"]
    client.post(
        f"/api/v1/purchase-orders/{order['id']}/receive",
        headers=admin_headers,
        json={"items": [{"item_id": item_id, "quantity": 1}]},
    )
    cancel = client.post(f"/api/v1/purchase-orders/{order['id']}/cancel", headers=admin_headers)
    assert cancel.status_code == 422  # já houve recebimento


def test_order_numbers_are_sequential(
    client: TestClient, admin_headers: dict, catalog: dict
) -> None:
    a = _create_order(client, admin_headers, catalog).json()["number"]
    b = _create_order(client, admin_headers, catalog).json()["number"]
    assert int(b.rsplit("-", 1)[1]) == int(a.rsplit("-", 1)[1]) + 1


def test_purchase_order_pdf(client: TestClient, admin_headers: dict, catalog: dict) -> None:
    order = _create_order(client, admin_headers, catalog).json()
    pdf = client.get(f"/api/v1/purchase-orders/{order['id']}/pdf", headers=admin_headers)
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")


def test_create_orders_from_replenishment_suggestions(
    client: TestClient, admin_headers: dict, catalog: dict
) -> None:
    # Estoque zerado com mínimo 10 → o produto precisa de reposição
    r = client.post(
        "/api/v1/purchase-orders/from-suggestions",
        headers=admin_headers,
        json={"warehouse_id": catalog["alm"].id},
    )
    assert r.status_code == 201, r.text
    orders = r.json()
    assert len(orders) == 1
    assert orders[0]["supplier"]["id"] == catalog["supplier"].id
    assert orders[0]["status"] == "draft"
