from datetime import datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models.dashboard import StoreOperationSummary
from app.models.master_data import Park, Partner, Store
from app.models.planning_records import Preorder

SHANGHAI = ZoneInfo("Asia/Shanghai")


def _source_fields(record_id: str, now: datetime) -> dict:
    return {
        "source_system": "DEMO_SEED",
        "source_record_id": record_id,
        "source_updated_at": now,
        "remark": "仅用于演示环境",
        "object_version": 1,
    }


def seed_dashboard_demo_data(db: Session) -> None:
    now = datetime.now(SHANGHAI)
    park_id = "PARK-DEMO-001"
    partner_id = "PARTNER-DEMO-001"
    if db.get(Park, park_id) is None:
        db.add(
            Park(
                park_id=park_id,
                park_name="新安食品产业园（演示）",
                address="黑龙江省哈尔滨市",
                longitude=Decimal("126.6424000"),
                latitude=Decimal("45.7567000"),
                status="ACTIVE",
                **_source_fields("DEMO-PARK-001", now),
            )
        )
    if db.get(Partner, partner_id) is None:
        db.add(
            Partner(
                partner_id=partner_id,
                partner_name="吉品演示渠道",
                partner_type="DEMO_CHANNEL",
                partner_contact_name="演示联系人",
                partner_phone="00000000000",
                partner_address="演示环境",
                relationship_status="ACTIVE",
                **_source_fields("DEMO-PARTNER-001", now),
            )
        )

    store_specs = [
        ("DEMO-TRAD-001", "哈尔滨传统门店（演示）", "哈尔滨", "TRADITIONAL_STORE", "126.6424", "45.7567"),
        ("DEMO-TRAD-002", "大庆传统门店（演示）", "大庆", "TRADITIONAL_STORE", "125.1038", "46.5893"),
        ("DEMO-SPACE-001", "长春冰雪第三空间（演示）", "长春", "THIRD_SPACE", "125.3235", "43.8171"),
        ("DEMO-SPACE-002", "沈阳黑土第三空间（演示）", "沈阳", "THIRD_SPACE", "123.4315", "41.8057"),
        ("DEMO-SPACE-003", "佳木斯玉米第三空间（演示）", "佳木斯", "THIRD_SPACE", "130.3189", "46.7998"),
    ]
    for store_id, name, city, channel, longitude, latitude in store_specs:
        if db.get(Store, store_id) is None:
            db.add(
                Store(
                    store_id=store_id,
                    partner_id=partner_id,
                    park_id=park_id,
                    channel_type=channel,
                    reporting_authorized=True,
                    store_name=name,
                    store_contact_name="演示联系人",
                    store_phone="00000000000",
                    delivery_address=f"{city}市演示地址",
                    city=city,
                    longitude=Decimal(longitude),
                    latitude=Decimal(latitude),
                    relationship_status="ACTIVE",
                    **_source_fields(f"DEMO-STORE-{store_id}", now),
                )
            )
    db.flush()

    start_day = now.date() - timedelta(days=6)
    for store_index, (store_id, _, _, channel, _, _) in enumerate(store_specs):
        for day_offset in range(7):
            day = start_day + timedelta(days=day_offset)
            preorder_id = f"DEMO-PRE-{store_index + 1:02d}-{day:%Y%m%d}"
            if db.get(Preorder, preorder_id) is None:
                third_space_boost = 18 if channel == "THIRD_SPACE" else 0
                quantity = Decimal(42 + store_index * 7 + day_offset * 4 + third_space_boost)
                required_at = datetime.combine(day, time(hour=9), SHANGHAI)
                db.add(
                    Preorder(
                        preorder_id=preorder_id,
                        partner_id=partner_id,
                        store_id=store_id,
                        product_id="DEMO-CORN-SET",
                        product_name="玉米轻食组合（演示）",
                        quantity=quantity,
                        unit="件",
                        required_at=required_at,
                        priority=1,
                        source_type="MANUAL",
                        status="CONFIRMED",
                        created_at=required_at - timedelta(days=2),
                        updated_at=required_at - timedelta(days=1),
                        **_source_fields(f"DEMO-SOURCE-{preorder_id}", now),
                    )
                )

            summary_id = f"DEMO-OPS-{store_index + 1:02d}-{day:%Y%m%d}"
            if db.get(StoreOperationSummary, summary_id) is None:
                order_count = 22 + store_index * 5 + day_offset * 2 + (10 if channel == "THIRD_SPACE" else 0)
                sales_amount = Decimal(order_count) * Decimal("38.60")
                db.add(
                    StoreOperationSummary(
                        object_id=summary_id,
                        event_id=f"EV-{summary_id}",
                        partner_id=partner_id,
                        store_id=store_id,
                        period_start=day,
                        period_end=day,
                        report_status="COMPLETE",
                        sales_amount=sales_amount,
                        currency="CNY",
                        order_count=order_count,
                        average_order_amount=Decimal("38.60"),
                        quantity=Decimal(order_count),
                        unit="件",
                        loss_quantity=Decimal(0),
                        closing_inventory=Decimal(80 + store_index * 8),
                        submitted_count=1,
                        missing_items=[],
                        report_version=1,
                        store_operation_version=1,
                        source_updated_at=datetime.combine(day, time(hour=22), SHANGHAI),
                        received_at=now,
                    )
                )
    db.commit()
