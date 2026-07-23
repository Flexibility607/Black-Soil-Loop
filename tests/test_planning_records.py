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


def test_preorder_procurement_quote_and_policy_crud(client: TestClient, demo_user: User) -> None:
    auth = headers(client)
    preorder = client.post(
        "/api/v1/preorders",
        headers=auth,
        json=event(
            "preorder",
            "PREORDER-001",
            {
                "preorder_id": "PREORDER-001",
                "partner_id": "PARTNER-001",
                "store_id": "STORE-001",
                "product_id": "PRODUCT-001",
                "product_name": "示例商品",
                "quantity": 100,
                "unit": "piece",
                "required_at": "2026-07-30T10:00:00+08:00",
                "source_type": "FILE",
                "status": "DRAFT",
                "created_at": "2026-07-23T09:00:00+08:00",
                "updated_at": "2026-07-23T09:00:00+08:00",
            },
            event_id="EV-PREORDER-001",
        ),
    )
    assert preorder.status_code == 201
    assert preorder.json()["data"]["quantity"] == 100

    preorder_update = client.patch(
        "/api/v1/preorders/PREORDER-001",
        headers=auth,
        json=event("preorder", "PREORDER-001", {"status": "CONFIRMED"}, event_id="EV-PREORDER-002"),
    )
    assert preorder_update.status_code == 200

    demand = client.post(
        "/api/v1/procurement-demands",
        headers=auth,
        json=event(
            "procurement_demand",
            "DEMAND-001",
            {
                "demand_id": "DEMAND-001",
                "enterprise_id": "ENT-001",
                "material_id": "MATERIAL-001",
                "material_name": "面粉",
                "demand_quantity": 1000,
                "unit": "kg",
                "period_start": "2026-07-27",
                "period_end": "2026-08-02",
                "source_type": "CALCULATED",
                "status": "DRAFT",
                "created_at": "2026-07-23T09:00:00+08:00",
            },
            event_id="EV-DEMAND-001",
        ),
    )
    assert demand.status_code == 201
    assert demand.json()["data"]["demand_quantity"] == 1000

    quote = client.post(
        "/api/v1/supplier-quotes",
        headers=auth,
        json=event(
            "supplier_quote",
            "TIER-001",
            {
                "supplier_id": "SUPPLIER-001",
                "supplier_name": "示例供应商",
                "material_id": "MATERIAL-001",
                "material_name": "面粉",
                "tier_id": "TIER-001",
                "minimum_kg": 0,
                "capacity_kg": 10000,
                "unit_price": 5.2,
                "currency": "CNY",
                "status": "ACTIVE",
            },
            event_id="EV-QUOTE-001",
        ),
    )
    assert quote.status_code == 201
    assert quote.json()["data"]["currency"] == "CNY"

    policy = client.post(
        "/api/v1/policies",
        headers=auth,
        json=event(
            "policy",
            "POLICY-001",
            {
                "policy_id": "POLICY-001",
                "title": "示例政策",
                "category": "数字化转型",
                "summary": "示例政策摘要",
                "source_url": "https://example.com/policy",
                "status": "ACTIVE",
            },
            event_id="EV-POLICY-001",
        ),
    )
    assert policy.status_code == 201
    assert policy.json()["data"]["policy_id"] == "POLICY-001"
