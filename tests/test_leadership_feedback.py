from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.core.security import hash_password
from app.models.business_records import Inventory
from app.models.operations import ProcurementHistory
from app.models.production import Bom, ProductionOrder, ProductionPlan
from app.models.transport import TransportResource, TransportTaskSummary
from app.models.user import User


def event(object_type: str, object_id: str, payload: dict, event_id: str, version: int = 1) -> dict:
    return {
        "schema_version": "1.0",
        "event_id": event_id,
        "object_type": object_type,
        "object_id": object_id,
        "object_version": version,
        "occurred_at": "2026-07-25T12:00:00+08:00",
        "payload": payload,
    }


def login_headers(client: TestClient, username: str, password: str = "demo-password") -> dict[str, str]:
    result = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    return {"Authorization": f"Bearer {result.json()['data']['access_token']}"}


def add_enterprise_user(db_session, user_id: str = "USER-ENT-001", username: str = "enterprise_leader") -> User:
    user = User(
        user_id=user_id,
        username=username,
        password_hash=hash_password("demo-password"),
        role="enterprise_admin",
        park_id="PARK-001",
        enterprise_ids=["ENT-001"],
    )
    db_session.add(user)
    db_session.commit()
    return user


def tracked(**values):
    return {"source_system": "TEST", "source_record_id": values.pop("source_record_id", "TEST-001"), "source_updated_at": datetime.now(timezone.utc), "object_version": 1, **values}


def test_store_scope_and_inventory_threshold_approval(client: TestClient, demo_user: User, db_session) -> None:
    add_enterprise_user(db_session)
    db_session.add(
        Inventory(
            **tracked(
                inventory_record_id="INV-THRESHOLD-001",
                enterprise_id="ENT-001",
                warehouse_id="WH-001",
                product_id="PRODUCT-001",
                product_name="冷冻玉米",
                category_id="CAT-001",
                unit="kg",
                current_qty=4,
                recorded_at=datetime.now(timezone.utc),
                status="ACTIVE",
            )
        )
    )
    db_session.commit()
    enterprise_headers = login_headers(client, "enterprise_leader")
    store = client.post(
        "/api/v1/stores",
        headers=enterprise_headers,
        json=event("store", "STORE-ENT-001", {"store_id": "STORE-ENT-001", "enterprise_id": "ENT-001", "partner_id": "PARTNER-001", "store_name": "企业门店", "store_contact_name": "负责人", "store_phone": "13000000000", "delivery_address": "园区内", "relationship_status": "ACTIVE"}, "EV-STORE-ENT-001"),
    )
    assert store.status_code == 201
    assert client.get("/api/v1/stores", headers=enterprise_headers).json()["data"]["total"] == 1

    threshold = client.post(
        "/api/v1/inventory-threshold-requests",
        headers=enterprise_headers,
        json=event("inventory_threshold_request", "THRESHOLD-001", {"threshold_request_id": "THRESHOLD-001", "inventory_record_id": "INV-THRESHOLD-001", "enterprise_id": "ENT-001", "product_id": "PRODUCT-001", "warehouse_id": "WH-001", "safety_stock_qty": 5, "remark": "企业提交"}, "EV-THRESHOLD-001"),
    )
    assert threshold.status_code == 201
    approval = client.post("/api/v1/inventory-threshold-requests/THRESHOLD-001/approve", headers=login_headers(client, "demo_admin"), json={"comment": "同意"})
    assert approval.status_code == 200
    alerts = client.get("/api/v1/inventory-alerts?status=OPEN", headers=enterprise_headers)
    assert alerts.status_code == 200
    assert alerts.json()["data"]["total"] == 1
    acknowledged = client.post(f"/api/v1/inventory-alerts/{alerts.json()['data']['items'][0]['alert_id']}/acknowledge", headers=enterprise_headers)
    assert acknowledged.status_code == 200


def test_rule_calculation_uses_unlinked_orders_and_purchase_history(client: TestClient, demo_user: User, db_session) -> None:
    db_session.add_all(
        [
            ProductionPlan(**tracked(source_record_id="PLAN-LEAD-001", plan_id="PLAN-LEAD-001", enterprise_id="ENT-001", product_id="PRODUCT-LEAD-001", product_name="冷冻水饺", planned_quantity=100, unit="kg", status="IN_PROGRESS")),
            ProductionOrder(**tracked(source_record_id="ORDER-LEAD-001", production_order_id="ORDER-LEAD-001", plan_id="PLAN-LEAD-001", enterprise_id="ENT-001", product_id="PRODUCT-LEAD-001", product_name="冷冻水饺", quantity=100, unit="kg", status="CONFIRMED")),
            ProductionOrder(**tracked(source_record_id="ORDER-LEAD-002", production_order_id="ORDER-LEAD-002", plan_id=None, enterprise_id="ENT-001", product_id="PRODUCT-LEAD-001", product_name="冷冻水饺", quantity=25, unit="kg", status="CONFIRMED")),
            Bom(**tracked(source_record_id="BOM-LEAD-001", bom_id="BOM-LEAD-001", enterprise_id="ENT-001", product_id="PRODUCT-LEAD-001", product_name="冷冻水饺", material_id="MATERIAL-LEAD-001", material_name="面粉", unit_usage_kg=0.5, unit_usage_unit="kg", status="ACTIVE")),
            ProcurementHistory(**tracked(source_record_id="PURCHASE-LEAD-001", purchase_record_id="PURCHASE-LEAD-001", enterprise_id="ENT-001", purchased_at=datetime.now(timezone.utc), material_id="MATERIAL-LEAD-001", material_name="面粉", quantity_kg=100, unit_price=5, currency="CNY", supplier_id="SUP-001", supplier_name="生产商甲", supplier_type="OTHER_PRODUCER", status="VALID")),
            ProcurementHistory(**tracked(source_record_id="PURCHASE-LEAD-002", purchase_record_id="PURCHASE-LEAD-002", enterprise_id="ENT-001", purchased_at=datetime.now(timezone.utc), material_id="MATERIAL-LEAD-001", material_name="面粉", quantity_kg=100, unit_price=4, currency="CNY", supplier_id="PARK-DIRECT", supplier_name="园区直供", supplier_type="PARK_DIRECT", status="VALID")),
        ]
    )
    db_session.commit()
    headers = login_headers(client, "demo_admin")
    demand = client.get("/api/v1/analytics/material-demand", headers=headers)
    assert demand.status_code == 200
    assert demand.json()["data"]["calc_results"]["items"][0]["quantity"] == 62.5
    procurement = client.post("/api/v1/procurements/aggregate-preview", headers=headers, json={"start_date": "2026-07-01", "end_date": "2026-07-31"})
    assert procurement.status_code == 200
    item = procurement.json()["data"]["calc_results"]["items"][0]
    assert item["recommended_supplier"]["supplier_id"] == "PARK-DIRECT"
    assert procurement.json()["data"]["calc_results"]["run_id"].startswith("CALC-")


def test_transport_preview_and_public_telemetry_are_structured(client: TestClient, demo_user: User, db_session) -> None:
    db_session.add_all(
        [
            TransportTaskSummary(**tracked(source_record_id="TASK-LEAD-001", task_id="TASK-LEAD-001", order_id="ORDER-LEAD-001", enterprise_id="ENT-001", status="CONFIRMED", status_version=1, origin="园区", destination="门店", vehicle_type_id="TRUCK-REFRIGERATED", vehicle_type_name="冷藏车", required_vehicle_count=1, estimated_fee=300, currency="CNY")),
            TransportResource(**tracked(source_record_id="RESOURCE-LEAD-001", driver_id="DRIVER-001", driver_name="司机甲", vehicle_id="VEHICLE-001", vehicle_type_id="TRUCK-REFRIGERATED", vehicle_type_name="冷藏车", plate_no="辽A00001", mass_capacity_kg=1000, volume_capacity_m3=10, temperature_min_celsius=0, temperature_max_celsius=4, humidity_min_percent=40, humidity_max_percent=70, on_duty=True, status="ACTIVE")),
        ]
    )
    db_session.commit()
    headers = login_headers(client, "demo_admin")
    preview = client.post("/api/v1/transport-matches/preview", headers=headers, json={"mass_kg": 500, "volume_m3": 4, "estimated_fee_per_vehicle": 300})
    assert preview.status_code == 200
    assert preview.json()["data"]["calc_results"]["matches"][0]["vehicle_type_id"] == "TRUCK-REFRIGERATED"
    telemetry = client.post(
        "/api/v1/transport-telemetry",
        headers=headers,
        json=event("transport_telemetry", "TELEMETRY-001", {"telemetry_id": "TELEMETRY-001", "task_id": "TASK-LEAD-001", "vehicle_id": "VEHICLE-001", "recorded_at": "2026-07-25T12:00:00+08:00", "actual_temperature_celsius": 8, "actual_humidity_percent": 50, "latitude": 41.8, "longitude": 123.4, "anomaly_status": "NORMAL", "source_type": "DEMO_SIMULATION"}, "EV-TELEMETRY-001"),
    )
    assert telemetry.status_code == 201
    assert telemetry.json()["data"]["anomaly_status"] == "TEMPERATURE_ABNORMAL"
    public_transport = client.get("/api/v1/public/dashboard/transport")
    assert public_transport.status_code == 200
    assert "plate_no" not in str(public_transport.json())
