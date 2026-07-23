from urllib.parse import quote

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


def test_transport_task_resource_and_freezer_crud(client: TestClient, demo_user: User) -> None:
    auth = headers(client)
    task = client.post(
        "/api/v1/transport-task-summaries",
        headers=auth,
        json=event(
            "transport_task",
            "TASK-001",
            {
                "task_id": "TASK-001",
                "order_id": "SALES-ORDER-001",
                "enterprise_id": "ENT-001",
                "status": "DRAFT",
                "status_version": 1,
                "origin": "园区仓库",
                "destination": "合作方门店",
            },
            event_id="EV-TASK-001",
        ),
    )
    assert task.status_code == 201
    assert task.json()["data"]["status_version"] == 1

    task_update = client.patch(
        "/api/v1/transport-task-summaries/TASK-001",
        headers=auth,
        json=event("transport_task", "TASK-001", {"status": "CONFIRMED"}, event_id="EV-TASK-002"),
    )
    assert task_update.status_code == 200
    assert task_update.json()["data"]["status_version"] == 2

    resource = client.post(
        "/api/v1/transport-resources",
        headers=auth,
        json=event(
            "transport_resource",
            "DRIVER-001",
            {
                "driver_id": "DRIVER-001",
                "driver_name": "示例司机",
                "vehicle_id": "VEHICLE-001",
                "mass_capacity_kg": 5000,
                "volume_capacity_m3": 20,
                "on_duty": True,
                "status": "ACTIVE",
            },
            event_id="EV-RESOURCE-001",
        ),
    )
    assert resource.status_code == 201
    assert resource.json()["data"]["mass_capacity_kg"] == 5000

    resource_update = client.patch(
        "/api/v1/transport-resources/DRIVER-001/VEHICLE-001",
        headers=auth,
        json=event("transport_resource", "DRIVER-001", {"on_duty": False}, event_id="EV-RESOURCE-002"),
    )
    assert resource_update.status_code == 200
    assert resource_update.json()["data"]["on_duty"] is False

    recorded_at = "2026-07-23T09:30:00+08:00"
    freezer = client.post(
        "/api/v1/freezer-records",
        headers=auth,
        json=event(
            "freezer_record",
            "FREEZER-001",
            {
                "freezer_id": "FREEZER-001",
                "park_id": "PARK-001",
                "enterprise_id": "ENT-001",
                "recorded_at": recorded_at,
                "frozen_goods_kg": 1000,
                "used_volume_m3": 80,
                "total_volume_m3": 100,
                "status": "ACTIVE",
            },
            event_id="EV-FREEZER-001",
        ),
    )
    assert freezer.status_code == 201
    assert freezer.json()["data"]["used_volume_m3"] == 80

    freezer_path = "/api/v1/freezer-records/FREEZER-001/" + quote(recorded_at, safe="")
    freezer_get = client.get(freezer_path, headers=auth)
    assert freezer_get.status_code == 200
    assert freezer_get.json()["data"]["freezer_id"] == "FREEZER-001"
