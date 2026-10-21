import pytest
from fastapi.testclient import TestClient

from app.models import Role


@pytest.mark.parametrize(
    ("role", "can_create_product", "can_move_stock", "can_adjust", "can_manage_users"),
    [
        (Role.VIEWER, False, False, False, False),
        (Role.OPERATOR, False, True, False, False),
        (Role.MANAGER, True, True, True, False),
        (Role.ADMIN, True, True, True, True),
    ],
)
def test_role_hierarchy(
    client: TestClient,
    headers_for,  # type: ignore[no-untyped-def]
    catalog: dict,
    role: Role,
    can_create_product: bool,
    can_move_stock: bool,
    can_adjust: bool,
    can_manage_users: bool,
) -> None:
    headers = headers_for(role)
    product = catalog["product"]
    alm = catalog["alm"]

    assert client.get("/api/v1/products", headers=headers).status_code == 200

    created = client.post(
        "/api/v1/products", headers=headers, json={"sku": f"N-{role.value}", "name": "Novo"}
    )
    assert (created.status_code == 201) is can_create_product

    entry = client.post(
        "/api/v1/stock/entries",
        headers=headers,
        json={"product_id": product.id, "warehouse_id": alm.id, "quantity": 5},
    )
    assert (entry.status_code == 201) is can_move_stock

    adjust = client.post(
        "/api/v1/stock/adjustments",
        headers=headers,
        json={
            "product_id": product.id,
            "warehouse_id": alm.id,
            "counted_quantity": 3,
            "notes": "contagem",
        },
    )
    assert (adjust.status_code == 200) is can_adjust

    assert (client.get("/api/v1/users", headers=headers).status_code == 200) is can_manage_users
