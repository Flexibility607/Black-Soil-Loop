from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi.testclient import TestClient

from app.models.dashboard import StoreOperationSummary
from app.models.master_data import Park, Partner, Store
from app.models.planning_records import Preorder


def source_fields(record_id: str) -> dict:
    return {
        "source_system": "TEST",
        "source_record_id": record_id,
        "source_updated_at": datetime(2026, 8, 1, tzinfo=timezone.utc),
    }


def add_dashboard_records(db_session) -> None:
    db_session.add_all(
        [
            Park(
                park_id="PARK-DASH",
                park_name="哈尔滨测试园区",
                address="哈尔滨",
                longitude=Decimal("126.6424"),
                latitude=Decimal("45.7567"),
                status="ACTIVE",
                **source_fields("park"),
            ),
            Partner(
                partner_id="PARTNER-DASH",
                partner_name="测试合作方",
                partner_type="STORE",
                partner_contact_name="测试",
                partner_phone="13800000000",
                partner_address="测试地址",
                relationship_status="ACTIVE",
                **source_fields("partner"),
            ),
        ]
    )
    db_session.add_all(
        [
            Store(
                store_id="STORE-TRAD",
                partner_id="PARTNER-DASH",
                park_id="PARK-DASH",
                channel_type="TRADITIONAL_STORE",
                reporting_authorized=True,
                store_name="传统测试门店",
                store_contact_name="测试",
                store_phone="13800000001",
                delivery_address="齐齐哈尔",
                city="齐齐哈尔市",
                longitude=Decimal("123.9182"),
                latitude=Decimal("47.3543"),
                relationship_status="ACTIVE",
                **source_fields("store-trad"),
            ),
            Store(
                store_id="STORE-THIRD",
                partner_id="PARTNER-DASH",
                park_id="PARK-DASH",
                channel_type="THIRD_SPACE",
                reporting_authorized=True,
                store_name="长春第三空间",
                store_contact_name="测试",
                store_phone="13800000002",
                delivery_address="长春",
                city="长春市",
                longitude=Decimal("125.3235"),
                latitude=Decimal("43.8171"),
                relationship_status="ACTIVE",
                **source_fields("store-third"),
            ),
            Store(
                store_id="STORE-LEGACY",
                partner_id="PARTNER-DASH",
                park_id="PARK-DASH",
                channel_type=None,
                reporting_authorized=False,
                store_name="待分类旧门店",
                store_contact_name="测试",
                store_phone="13800000003",
                delivery_address="哈尔滨",
                city="哈尔滨市",
                longitude=None,
                latitude=None,
                relationship_status="ACTIVE",
                **source_fields("store-legacy"),
            ),
        ]
    )
    required_at = datetime(2026, 8, 2, 4, tzinfo=timezone.utc)
    preorder_rows = [
        ("PRE-1", "STORE-TRAD", 100, "公斤", "CONFIRMED"),
        ("PRE-2", "STORE-THIRD", 40, "公斤", "COMPLETED"),
        ("PRE-3", "STORE-THIRD", 8, "箱", "CONFIRMED"),
        ("PRE-4", "STORE-THIRD", 999, "公斤", "DRAFT"),
        ("PRE-5", "STORE-LEGACY", 999, "公斤", "CONFIRMED"),
    ]
    for preorder_id, store_id, quantity, unit, status in preorder_rows:
        db_session.add(
            Preorder(
                preorder_id=preorder_id,
                partner_id="PARTNER-DASH",
                store_id=store_id,
                product_id="PRODUCT-1",
                product_name="测试商品",
                quantity=Decimal(quantity),
                unit=unit,
                required_at=required_at,
                priority=1,
                source_type="STORE",
                status=status,
                created_at=required_at,
                updated_at=required_at,
                **source_fields(preorder_id),
            )
        )
    for object_id, event_id, store_id, orders, sales in [
        ("OP-TRAD", "EVENT-TRAD", "STORE-TRAD", 30, "3000.00"),
        ("OP-THIRD", "EVENT-THIRD", "STORE-THIRD", 70, "7000.00"),
    ]:
        db_session.add(
            StoreOperationSummary(
                object_id=object_id,
                event_id=event_id,
                partner_id="PARTNER-DASH",
                store_id=store_id,
                period_start=date(2026, 8, 2),
                period_end=date(2026, 8, 2),
                report_status="COMPLETE",
                sales_amount=Decimal(sales),
                currency="CNY",
                order_count=orders,
                average_order_amount=Decimal(sales) / orders,
                quantity=Decimal(orders),
                unit="件",
                loss_quantity=Decimal(0),
                closing_inventory=Decimal(10),
                submitted_count=1,
                missing_items=[],
                report_version=1,
                store_operation_version=1,
                source_updated_at=required_at,
                received_at=required_at,
            )
        )
    db_session.commit()


def test_dashboard_snapshot_splits_units_channels_and_coordinates(client: TestClient, db_session) -> None:
    add_dashboard_records(db_session)
    response = client.get(
        "/api/v1/public/dashboard/snapshot",
        params={
            "park_id": "PARK-DASH",
            "start_at": "2026-08-01T00:00:00+08:00",
            "end_at": "2026-08-04T00:00:00+08:00",
        },
    )

    assert response.status_code == 200
    snapshot = response.json()["data"]
    assert snapshot["headline"]["preorder_count"] == 4
    assert {item["unit"]: item["quantity"] for item in snapshot["headline"]["demand_totals"]} == {
        "公斤": 1139.0,
        "箱": 8.0,
    }
    channels = {item["channel_type"]: item for item in snapshot["channel_mix"]}
    assert channels["THIRD_SPACE"]["operation_order_share"] == 70.0
    assert channels["THIRD_SPACE"]["sales_share"] == 70.0
    assert snapshot["third_spaces"][0]["city"] == "长春市"
    assert snapshot["data_quality"]["missing_store_classification_count"] == 1
    assert snapshot["data_quality"]["report_coverage"] == 100.0
    nodes = {item["node_id"]: item for item in snapshot["map_nodes"]}
    assert nodes["PARK-DASH"]["latitude"] > nodes["STORE-THIRD"]["latitude"]


def test_legacy_preorders_endpoint_uses_filters_and_empty_denominators(client: TestClient, db_session) -> None:
    add_dashboard_records(db_session)
    preorders = client.get(
        "/api/v1/public/dashboard/preorders",
        params={
            "park_id": "PARK-DASH",
            "channel_type": "THIRD_SPACE",
            "start_at": "2026-08-01T00:00:00+08:00",
            "end_at": "2026-08-04T00:00:00+08:00",
        },
    )
    assert preorders.status_code == 200
    assert len(preorders.json()["data"]) == 2

    db_session.query(StoreOperationSummary).delete()
    db_session.commit()
    snapshot = client.get(
        "/api/v1/public/dashboard/snapshot",
        params={
            "park_id": "PARK-DASH",
            "start_at": "2026-08-01T00:00:00+08:00",
            "end_at": "2026-08-04T00:00:00+08:00",
        },
    ).json()["data"]
    assert all(item["operation_order_share"] is None for item in snapshot["channel_mix"])
    assert all(item["sales_share"] is None for item in snapshot["channel_mix"])
