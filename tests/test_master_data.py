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


def test_master_data_crud_and_version_conflict(client: TestClient, demo_user: User) -> None:
    auth = headers(client)
    create = client.post(
        "/api/v1/parks",
        headers=auth,
        json=event("park", "PARK-001", {"park_id": "PARK-001", "park_name": "示例园区", "address": None, "status": "ACTIVE"}, event_id="EV-PARK-001"),
    )

    assert create.status_code == 201
    assert create.json()["data"]["object_version"] == 1
    assert create.json()["data"]["source_system"] == "WEB_API"

    duplicate_event = client.post(
        "/api/v1/parks",
        headers=auth,
        json=event("park", "PARK-999", {"park_id": "PARK-999", "park_name": "重复事件", "status": "ACTIVE"}, event_id="EV-PARK-001"),
    )
    assert duplicate_event.status_code == 409
    assert duplicate_event.json()["code"] == "IDEMPOTENCY_CONFLICT"

    listed = client.get("/api/v1/parks?page=1&page_size=20&keyword=示例", headers=auth)
    assert listed.status_code == 200
    assert listed.json()["data"]["total"] == 1

    update = client.patch(
        "/api/v1/parks/PARK-001",
        headers=auth,
        json=event("park", "PARK-001", {"park_name": "新示例园区"}, event_id="EV-PARK-002"),
    )
    conflict = client.patch(
        "/api/v1/parks/PARK-001",
        headers=auth,
        json=event("park", "PARK-001", {"park_name": "过期写入"}, event_id="EV-PARK-003"),
    )

    assert update.status_code == 200
    assert update.json()["data"]["object_version"] == 2
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "VERSION_CONFLICT"


def test_enterprise_admin_cannot_write_park_or_other_enterprise(client: TestClient, demo_user: User, db_session) -> None:
    db_session.add(
        User(
            user_id="USER-002",
            username="enterprise_admin",
            password_hash=demo_user.password_hash,
            role="enterprise_admin",
            park_id="PARK-001",
            enterprise_ids=["ENT-001"],
        )
    )
    db_session.commit()
    login = client.post("/api/v1/auth/login", json={"username": "enterprise_admin", "password": "demo-password"})
    access_token = login.json()["data"]["access_token"]
    auth = {"Authorization": f"Bearer {access_token}"}

    park_create = client.post(
        "/api/v1/parks",
        headers=auth,
        json=event("park", "PARK-002", {"park_id": "PARK-002", "park_name": "越权园区", "status": "ACTIVE"}, event_id="EV-PARK-004"),
    )

    assert park_create.status_code == 403
