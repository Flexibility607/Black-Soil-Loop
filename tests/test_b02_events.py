import json
from datetime import datetime, timezone
from decimal import Decimal
from time import time

from fastapi.testclient import TestClient

from app.models.dashboard import StoreOperationSummary
from app.models.master_data import Park, Partner, Store
from app.services.b02_exchange import service_signature

SECRET = "development-b02-shared-secret-change-me"
PATH = "/api/v1/internal/b02/events"


def add_store(db_session) -> None:
    source = {
        "source_system": "TEST",
        "source_updated_at": datetime(2026, 8, 1, tzinfo=timezone.utc),
    }
    db_session.add(
        Park(
            park_id="PARK-B02",
            park_name="B02 测试园区",
            status="ACTIVE",
            source_record_id="park",
            **source,
        )
    )
    db_session.add(
        Partner(
            partner_id="PARTNER-B02",
            partner_name="B02 合作方",
            partner_type="STORE",
            partner_contact_name="测试",
            partner_phone="13800000000",
            partner_address="测试地址",
            relationship_status="ACTIVE",
            source_record_id="partner",
            **source,
        )
    )
    db_session.add(
        Store(
            store_id="STORE-B02",
            partner_id="PARTNER-B02",
            park_id="PARK-B02",
            channel_type="THIRD_SPACE",
            reporting_authorized=True,
            store_name="B02 第三空间",
            store_contact_name="测试",
            store_phone="13800000001",
            delivery_address="测试地址",
            relationship_status="ACTIVE",
            source_record_id="store",
            **source,
        )
    )
    db_session.commit()


def event(version: int = 1, event_id: str = "EVENT-B02-1", *, missing: bool = False) -> dict:
    report = {
        "summary_type": "STORE_OPERATION_SUMMARY",
        "partner_id": "PARTNER-B02",
        "store_id": "STORE-B02",
        "period_start": "2026-08-02",
        "period_end": "2026-08-02",
        "report_status": "MISSING" if missing else "COMPLETE",
        "sales_amount": None if missing else 1200 + version,
        "currency": "CNY",
        "order_count": None if missing else 12 + version,
        "average_order_amount": None if missing else 100,
        "quantity": None if missing else 13,
        "unit": None if missing else "件",
        "loss_quantity": None if missing else 0,
        "closing_inventory": None if missing else 20,
        "submitted_count": 0 if missing else 1,
        "missing_items": ["sales_amount", "order_count"] if missing else [],
        "report_version": None if missing else version,
        "store_operation_version": version,
        "updated_at": "2026-08-02T12:00:00+08:00",
    }
    return {
        "schema_version": "1.0",
        "event_id": event_id,
        "trace_id": f"TRACE-B02-{version}",
        "object_type": "store_operation_summary",
        "object_id": "STORE-B02:2026-08-02",
        "object_version": version,
        "occurred_at": "2026-08-02T12:00:00+08:00",
        "payload": report,
    }


def post_event(client: TestClient, payload: dict, nonce: str, timestamp: int | None = None):
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    timestamp_value = str(timestamp if timestamp is not None else int(time()))
    headers = {
        "Content-Type": "application/json",
        "X-Service-Id": "B02",
        "X-Timestamp": timestamp_value,
        "X-Nonce": nonce,
        "X-Signature": service_signature("POST", PATH, timestamp_value, nonce, body, SECRET),
    }
    return client.post(PATH, content=body, headers=headers)


def test_b02_idempotency_nonce_and_continuous_versions(client: TestClient, db_session) -> None:
    add_store(db_session)
    first_payload = event()
    first = post_event(client, first_payload, "nonce-1")
    duplicate = post_event(client, first_payload, "nonce-2")
    assert first.status_code == 200
    assert duplicate.status_code == 200
    assert first.json()["data"] == duplicate.json()["data"]

    changed = event()
    changed["payload"]["sales_amount"] = 9999
    conflict = post_event(client, changed, "nonce-3")
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"

    replay = post_event(client, event(2, "EVENT-B02-2"), "nonce-3")
    assert replay.status_code == 409
    assert replay.json()["code"] == "IDEMPOTENCY_CONFLICT"

    gap = post_event(client, event(3, "EVENT-B02-3"), "nonce-4")
    assert gap.status_code == 409
    assert gap.json()["code"] == "VERSION_GAP"

    correction = post_event(client, event(2, "EVENT-B02-2"), "nonce-5")
    assert correction.status_code == 200
    summary = db_session.get(StoreOperationSummary, "STORE-B02:2026-08-02")
    assert summary.store_operation_version == 2
    assert summary.sales_amount == Decimal("1202.00")

    old = post_event(client, event(1, "EVENT-B02-OLD"), "nonce-6")
    assert old.status_code == 409
    assert old.json()["code"] == "VERSION_CONFLICT"


def test_b02_rejects_expired_signatures_and_invalid_missing_values(client: TestClient, db_session) -> None:
    add_store(db_session)
    expired = post_event(client, event(), "expired", int(time()) - 1_000)
    assert expired.status_code == 401

    invalid = event(missing=True)
    invalid["payload"]["sales_amount"] = 1
    response = post_event(client, invalid, "invalid-missing")
    assert response.status_code == 400
    assert response.json()["code"] == "VALIDATION_ERROR"

