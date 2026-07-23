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


def test_production_plans_and_orders_crud(client: TestClient, demo_user: User) -> None:
    auth = headers(client)
    plan = client.post(
        "/api/v1/production-plans",
        headers=auth,
        json=event(
            "production_plan",
            "PLAN-001",
            {
                "plan_id": "PLAN-001",
                "enterprise_id": "ENT-001",
                "product_id": "PRODUCT-001",
                "product_name": "示例半成品",
                "planned_quantity": 1000,
                "unit": "piece",
                "status": "NOT_STARTED",
            },
            event_id="EV-PLAN-001",
        ),
    )

    assert plan.status_code == 201
    assert plan.json()["data"]["plan_id"] == "PLAN-001"
    assert plan.json()["data"]["object_version"] == 1

    listed = client.get("/api/v1/production-plans?keyword=示例", headers=auth)
    assert listed.status_code == 200
    assert listed.json()["data"]["total"] == 1

    update = client.patch(
        "/api/v1/production-plans/PLAN-001",
        headers=auth,
        json=event("production_plan", "PLAN-001", {"status": "IN_PROGRESS"}, event_id="EV-PLAN-002"),
    )
    stale = client.patch(
        "/api/v1/production-plans/PLAN-001",
        headers=auth,
        json=event("production_plan", "PLAN-001", {"status": "COMPLETED"}, event_id="EV-PLAN-003"),
    )

    assert update.status_code == 200
    assert update.json()["data"]["status"] == "IN_PROGRESS"
    assert stale.status_code == 409
    assert stale.json()["code"] == "VERSION_CONFLICT"

    order = client.post(
        "/api/v1/production-orders",
        headers=auth,
        json=event(
            "production_order",
            "PRODUCTION-ORDER-001",
            {
                "production_order_id": "PRODUCTION-ORDER-001",
                "plan_id": "PLAN-001",
                "enterprise_id": "ENT-001",
                "product_id": "PRODUCT-001",
                "product_name": "示例半成品",
                "quantity": 100,
                "unit": "piece",
                "status": "CONFIRMED",
            },
            event_id="EV-ORDER-001",
        ),
    )

    assert order.status_code == 201
    assert order.json()["data"]["plan_id"] == "PLAN-001"


def test_bom_composite_key_and_general_bom_scope(client: TestClient, demo_user: User) -> None:
    auth = headers(client)
    bom = client.post(
        "/api/v1/boms",
        headers=auth,
        json=event(
            "bom",
            "BOM-001",
            {
                "bom_id": "BOM-001",
                "enterprise_id": None,
                "product_id": "PRODUCT-001",
                "product_name": "示例半成品",
                "material_id": "MATERIAL-001",
                "material_name": "面粉",
                "unit_usage_kg": 0.25,
                "unit_usage_unit": "kg/piece",
                "status": "ACTIVE",
            },
            event_id="EV-BOM-001",
        ),
    )

    assert bom.status_code == 201
    assert bom.json()["data"]["enterprise_id"] is None

    duplicate_key = client.post(
        "/api/v1/boms",
        headers=auth,
        json=event(
            "bom",
            "BOM-001",
            {
                "bom_id": "BOM-001",
                "enterprise_id": "ENT-001",
                "product_id": "PRODUCT-001",
                "product_name": "示例半成品",
                "material_id": "MATERIAL-001",
                "material_name": "面粉",
                "unit_usage_kg": 0.3,
                "unit_usage_unit": "kg/piece",
                "status": "ACTIVE",
            },
            event_id="EV-BOM-002",
        ),
    )
    assert duplicate_key.status_code == 409
    assert duplicate_key.json()["code"] == "IDEMPOTENCY_CONFLICT"

    update = client.patch(
        "/api/v1/boms/BOM-001/PRODUCT-001/MATERIAL-001",
        headers=auth,
        json=event("bom", "BOM-001", {"status": "INACTIVE"}, event_id="EV-BOM-003"),
    )
    assert update.status_code == 200
    assert update.json()["data"]["object_version"] == 2
