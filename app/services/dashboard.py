from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.dashboard import StoreOperationSummary
from app.models.master_data import Park, Store
from app.models.planning_records import Preorder
from app.schemas.dashboard import (
    ChannelMetric,
    DailyTrendPoint,
    DashboardDataQuality,
    DashboardHeadline,
    DashboardSnapshot,
    DemandTotal,
    MapEdge,
    MapNode,
    ThirdSpaceMetric,
)

SHANGHAI = ZoneInfo("Asia/Shanghai")
CHANNELS = ("TRADITIONAL_STORE", "THIRD_SPACE")
CHANNEL_LABELS = {"TRADITIONAL_STORE": "传统门店", "THIRD_SPACE": "第三空间"}
VALID_PREORDER_STATUSES = ("CONFIRMED", "COMPLETED")


def number(value: Decimal | float | None) -> float:
    return 0.0 if value is None else float(value)


def _aware(value: datetime, tz: ZoneInfo = SHANGHAI) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=tz)
    return value.astimezone(tz)


def resolve_dashboard_window(start_at: datetime | None, end_at: datetime | None) -> tuple[datetime, datetime]:
    now = datetime.now(SHANGHAI)
    end = _aware(end_at) if end_at else now
    start = _aware(start_at) if start_at else datetime.combine(end.date() - timedelta(days=29), time.min, SHANGHAI)
    if end <= start:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "end_at 必须晚于 start_at"})
    if end - start > timedelta(days=366):
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "统计时间范围不能超过 366 天"})
    return start, end


def _select_park(db: Session, settings: Settings, park_id: str | None) -> Park | None:
    resolved_id = park_id or settings.default_dashboard_park_id
    if resolved_id:
        park = db.get(Park, resolved_id)
        if park is None:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "园区不存在"})
        return park
    return db.scalar(select(Park).where(Park.status == "ACTIVE").order_by(Park.park_id).limit(1))


def _demand_list(values: dict[str, float]) -> list[DemandTotal]:
    return [DemandTotal(unit=unit, quantity=round(quantity, 3)) for unit, quantity in sorted(values.items())]


def _share(value: float, total: float) -> float | None:
    return None if total <= 0 else round(value / total * 100, 1)


def build_dashboard_snapshot(
    db: Session,
    settings: Settings,
    *,
    park_id: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> DashboardSnapshot:
    range_start, range_end = resolve_dashboard_window(start_at, end_at)
    park = _select_park(db, settings, park_id)
    selected_park_id = park.park_id if park else park_id

    store_statement = select(Store).where(Store.relationship_status == "ACTIVE")
    if selected_park_id:
        store_statement = store_statement.where(Store.park_id == selected_park_id)
    stores = list(db.scalars(store_statement.order_by(Store.store_id)))
    store_by_id = {store.store_id: store for store in stores}
    classified_stores = {store_id: store for store_id, store in store_by_id.items() if store.channel_type in CHANNELS}

    preorder_statement = select(Preorder).where(
        Preorder.status.in_(VALID_PREORDER_STATUSES),
        Preorder.required_at >= range_start.astimezone(timezone.utc),
        Preorder.required_at < range_end.astimezone(timezone.utc),
    )
    preorders = [record for record in db.scalars(preorder_statement) if record.store_id in store_by_id]

    start_date = range_start.date()
    end_date = range_end.date()
    summary_statement = select(StoreOperationSummary).where(
        StoreOperationSummary.period_end >= start_date,
        StoreOperationSummary.period_start <= end_date,
    )
    summaries = [record for record in db.scalars(summary_statement) if record.store_id in classified_stores]

    total_demand: dict[str, float] = defaultdict(float)
    channel_preorder_count = {channel: 0 for channel in CHANNELS}
    channel_demand: dict[str, dict[str, float]] = {channel: defaultdict(float) for channel in CHANNELS}
    store_preorder_count: dict[str, int] = defaultdict(int)
    store_demand: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    daily: dict[tuple[date, str], dict] = {}

    cursor = start_date
    while cursor <= end_date:
        for channel in CHANNELS:
            daily[(cursor, channel)] = {
                "preorder_count": 0,
                "demand": defaultdict(float),
                "operation_order_count": 0,
                "sales_amount": 0.0,
            }
        cursor += timedelta(days=1)

    for preorder in preorders:
        store = store_by_id[preorder.store_id]
        quantity = number(preorder.quantity)
        total_demand[preorder.unit] += quantity
        if store.channel_type not in CHANNELS:
            continue
        channel = store.channel_type
        channel_preorder_count[channel] += 1
        channel_demand[channel][preorder.unit] += quantity
        store_preorder_count[store.store_id] += 1
        store_demand[store.store_id][preorder.unit] += quantity
        point = daily.get((_aware(preorder.required_at).date(), channel))
        if point is not None:
            point["preorder_count"] += 1
            point["demand"][preorder.unit] += quantity

    channel_operation_orders = {channel: 0 for channel in CHANNELS}
    channel_sales = {channel: 0.0 for channel in CHANNELS}
    store_operation_orders: dict[str, int] = defaultdict(int)
    store_sales: dict[str, float] = defaultdict(float)
    store_last_report: dict[str, StoreOperationSummary] = {}
    reported_store_ids: set[str] = set()

    for summary in summaries:
        store = classified_stores[summary.store_id]
        channel = store.channel_type
        if summary.report_status != "MISSING":
            reported_store_ids.add(store.store_id)
        orders = summary.order_count or 0
        sales = number(summary.sales_amount)
        channel_operation_orders[channel] += orders
        channel_sales[channel] += sales
        store_operation_orders[store.store_id] += orders
        store_sales[store.store_id] += sales
        point = daily.get((summary.period_start, channel))
        if point is not None:
            point["operation_order_count"] += orders
            point["sales_amount"] += sales
        previous = store_last_report.get(store.store_id)
        if previous is None or (summary.period_end, summary.store_operation_version) > (previous.period_end, previous.store_operation_version):
            store_last_report[store.store_id] = summary

    operation_total = sum(channel_operation_orders.values())
    sales_total = sum(channel_sales.values())
    channel_mix = [
        ChannelMetric(
            channel_type=channel,
            display_name=CHANNEL_LABELS[channel],
            preorder_count=channel_preorder_count[channel],
            demand_totals=_demand_list(channel_demand[channel]),
            operation_order_count=channel_operation_orders[channel],
            operation_order_share=_share(channel_operation_orders[channel], operation_total),
            sales_amount=round(channel_sales[channel], 2),
            sales_share=_share(channel_sales[channel], sales_total),
        )
        for channel in CHANNELS
    ]

    daily_trend = [
        DailyTrendPoint(
            date=day,
            channel_type=channel,
            preorder_count=values["preorder_count"],
            demand_totals=_demand_list(values["demand"]),
            operation_order_count=values["operation_order_count"],
            sales_amount=round(values["sales_amount"], 2),
        )
        for (day, channel), values in sorted(daily.items())
    ]

    third_spaces = []
    for store in stores:
        if store.channel_type != "THIRD_SPACE":
            continue
        last_report = store_last_report.get(store.store_id)
        third_spaces.append(
            ThirdSpaceMetric(
                store_id=store.store_id,
                store_name=store.store_name,
                city=store.city,
                longitude=None if store.longitude is None else float(store.longitude),
                latitude=None if store.latitude is None else float(store.latitude),
                preorder_count=store_preorder_count[store.store_id],
                demand_totals=_demand_list(store_demand[store.store_id]),
                operation_order_count=store_operation_orders[store.store_id],
                sales_amount=round(store_sales[store.store_id], 2),
                last_report_date=None if last_report is None else last_report.period_end,
                last_report_status=None if last_report is None else last_report.report_status,
                is_demo=store.store_id.startswith("DEMO-"),
            )
        )
    third_spaces.sort(key=lambda item: (-item.sales_amount, item.store_name))

    map_nodes: list[MapNode] = []
    map_edges: list[MapEdge] = []
    if park and park.longitude is not None and park.latitude is not None:
        map_nodes.append(
            MapNode(
                node_id=park.park_id,
                node_type="PARK",
                display_name=park.park_name,
                city=None,
                longitude=float(park.longitude),
                latitude=float(park.latitude),
            )
        )
        for store in stores:
            if store.channel_type not in CHANNELS or store.longitude is None or store.latitude is None:
                continue
            map_nodes.append(
                MapNode(
                    node_id=store.store_id,
                    node_type=store.channel_type,
                    display_name=store.store_name,
                    city=store.city,
                    longitude=float(store.longitude),
                    latitude=float(store.latitude),
                )
            )
            map_edges.append(MapEdge(source_id=park.park_id, target_id=store.store_id, channel_type=store.channel_type))

    missing_classification = sum(1 for store in stores if store.channel_type not in CHANNELS)
    missing_coordinates = sum(
        1 for store in stores if store.channel_type in CHANNELS and (store.longitude is None or store.latitude is None)
    ) + (1 if park and (park.longitude is None or park.latitude is None) else 0)
    authorized_store_ids = {store.store_id for store in stores if store.channel_type in CHANNELS and store.reporting_authorized}
    missing_reports = len(authorized_store_ids - reported_store_ids)
    report_coverage = None if not authorized_store_ids else round(len(reported_store_ids & authorized_store_ids) / len(authorized_store_ids) * 100, 1)
    warnings: list[str] = []
    if missing_classification:
        warnings.append(f"{missing_classification} 家门店缺少渠道分类")
    if missing_coordinates:
        warnings.append(f"{missing_coordinates} 个园区或门店缺少坐标")
    if missing_reports:
        warnings.append(f"{missing_reports} 家已授权门店在当前周期无有效日报")

    return DashboardSnapshot(
        park_id=selected_park_id,
        park_name=park.park_name if park else "全部园区",
        range_start=range_start,
        range_end=range_end,
        headline=DashboardHeadline(
            preorder_count=len(preorders),
            demand_totals=_demand_list(total_demand),
            operation_order_count=operation_total,
            sales_amount=round(sales_total, 2),
            currency="CNY",
        ),
        channel_mix=channel_mix,
        daily_trend=daily_trend,
        third_spaces=third_spaces,
        map_nodes=map_nodes,
        map_edges=map_edges,
        data_quality=DashboardDataQuality(
            store_count=len(stores),
            reporting_store_count=len(reported_store_ids),
            missing_store_classification_count=missing_classification,
            missing_coordinate_count=missing_coordinates,
            missing_report_count=missing_reports,
            report_coverage=report_coverage,
            warnings=warnings,
        ),
        demo_mode=bool(settings.demo_data_enabled and selected_park_id and selected_park_id.startswith("PARK-DEMO")),
    )
