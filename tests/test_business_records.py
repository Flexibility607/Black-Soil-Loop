from fastapi.testclient import TestClient

from app.models.user import User


def event(object_type: str, object_id: str, payload: dict, *, event_id: str, version: int = 1) -> dict:
    return {
        "schema_version": "1.0",
        "event_id": event_id,
        "object_type": object_type,
        "object_id": object_id,
        "object_version": version,
        "occurred_at": "2026-07-23T12:00:00+08:00",
        "payload": payload,
    }


def headers(client: TestClient) -> dict[str, str]:
    login = client.post("/api/v1/auth/login", json={"username": "demo_admin", "password": "demo-password"})
    access_token = login.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {access_token}"}


def test_inventory_sales_and_return_records(client: TestClient, demo_user: User) -> None:
    auth = headers(client)
    inventory = client.post(
        "/api/v1/inventories",
        headers=auth,
        json=event(
            "inventory",
            "INVENTORY-001",
            {
                "inventory_record_id": "INVENTORY-001",
                "enterprise_id": "ENT-001",
                "warehouse_id": "WAREHOUSE-001",
                "product_id": "PRODUCT-001",
                "product_name": "示例商品",
                "category_id": "MEAT",
                "unit": "kg",
                "current_qty": 120,
                "recorded_at": "2026-07-23T09:30:00+08:00",
                "status": "ACTIVE",
            },
            event_id="EV-INVENTORY-001",
        ),
    )
    assert inventory.status_code == 201
    assert inventory.json()["data"]["current_qty"] == 120

    inventory_list = client.get(
        "/api/v1/inventories?enterprise_id=ENT-001&start_at=2026-07-23T00:00:00%2B08:00",
        headers=auth,
    )
    assert inventory_list.status_code == 200
    assert inventory_list.json()["data"]["total"] == 1

    inventory_update = client.patch(
        "/api/v1/inventories/INVENTORY-001",
        headers=auth,
        json=event("inventory", "INVENTORY-001", {"current_qty": 110}, event_id="EV-INVENTORY-002"),
    )
    assert inventory_update.status_code == 200
    assert inventory_update.json()["data"]["object_version"] == 2

    sales_line = client.post(
        "/api/v1/sales-order-lines",
        headers=auth,
        json=event(
            "sales_order_line",
            "SALES-ORDER-001",
            {
                "sales_order_id": "SALES-ORDER-001",
                "line_no": 1,
                "enterprise_id": "ENT-001",
                "ordered_at": "2026-07-23T10:00:00+08:00",
                "product_id": "PRODUCT-001",
                "product_name": "示例商品",
                "quantity": 10,
                "unit": "box",
                "currency": "CNY",
                "status": "CONFIRMED",
            },
            event_id="EV-SALES-001",
        ),
    )
    assert sales_line.status_code == 201
    assert sales_line.json()["data"]["line_no"] == 1

    duplicate_line = client.post(
        "/api/v1/sales-order-lines",
        headers=auth,
        json=event(
            "sales_order_line",
            "SALES-ORDER-001",
            {
                "sales_order_id": "SALES-ORDER-001",
                "line_no": 1,
                "enterprise_id": "ENT-001",
                "ordered_at": "2026-07-23T10:00:00+08:00",
                "product_id": "PRODUCT-002",
                "product_name": "另一个商品",
                "quantity": 2,
                "unit": "box",
                "currency": "CNY",
                "status": "DRAFT",
            },
            event_id="EV-SALES-002",
        ),
    )
    assert duplicate_line.status_code == 409

    invalid_currency = client.post(
        "/api/v1/returns",
        headers=auth,
        json=event(
            "return",
            "RETURN-001",
            {
                "return_id": "RETURN-001",
                "sales_order_id": "SALES-ORDER-001",
                "enterprise_id": "ENT-001",
                "product_id": "PRODUCT-001",
                "product_name": "示例商品",
                "quantity": 1,
                "unit": "box",
                "reason": "包装破损",
                "currency": "USD",
                "returned_at": "2026-07-23T11:00:00+08:00",
                "status": "CONFIRMED",
            },
            event_id="EV-RETURN-001",
        ),
    )
    assert invalid_currency.status_code == 400

    returned = client.post(
        "/api/v1/returns",
        headers=auth,
        json=event(
            "return",
            "RETURN-001",
            {
                "return_id": "RETURN-001",
                "sales_order_id": "SALES-ORDER-001",
                "line_no": 1,
                "enterprise_id": "ENT-001",
                "product_id": "PRODUCT-001",
                "product_name": "示例商品",
                "quantity": 1,
                "unit": "box",
                "reason": "包装破损",
                "amount": 100,
                "currency": "CNY",
                "returned_at": "2026-07-23T11:00:00+08:00",
                "status": "CONFIRMED",
            },
            event_id="EV-RETURN-002",
        ),
    )
    assert returned.status_code == 201
    assert returned.json()["data"]["currency"] == "CNY"
