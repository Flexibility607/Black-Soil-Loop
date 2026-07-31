from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes.master_data import record_data
from app.db.session import get_db
from app.models.business_records import Inventory, SalesOrderLine
from app.models.master_data import Enterprise, Partner
from app.models.operations import CalculationRun, EnterpriseCapacity, InventoryAlert, InventoryThresholdRequest, ProcurementHistory, TransportTelemetry
from app.models.planning_records import Policy, Preorder
from app.models.production import Bom, ProductionOrder, ProductionPlan
from app.models.transport import FreezerRecord, TransportResource, TransportTaskSummary
from app.models.user import User
from app.schemas.common import ResponseEnvelope, response_envelope

router = APIRouter(tags=["E01 Analytics"])
public_router = APIRouter(tags=["E02 Public Dashboard"])

PUBLIC_POLICY_LINKS = {
    "northeast_revitalization": "https://www.ndrc.gov.cn/xwdt/xwfb/201603/t20160302_955443.html",
    "northeast_plan": "https://www.ndrc.gov.cn/xxgk/zcfb/ghwb/201612/t20161219_962212.html",
    "fifteenth_plan": "https://www.npc.gov.cn/npc/c2/c30834/202603/t20260316_453274.html",
    "food_safety": "https://flk.npc.gov.cn/detail?fileId=&id=ff8081817ab22e0c017abd8d85a205f1&title=%E4%B8%AD%E5%8D%8E%E4%BA%BA%E6%B0%91%E5%85%B1%E5%92%8C%E5%9B%BD%E9%A3%9F%E5%93%81%E5%AE%89%E5%85%A8%E6%B3%95&type=",
    "cold_chain": "https://scs.moa.gov.cn/ccll/zcwj/202312/t20231228_6443655.htm",
    "cold_storage": "https://scs.moa.gov.cn/ccll/zcwj/202302/t20230203_6419753.htm",
    "changchun_industry": "https://drc.changchun.gov.cn/fzgg/fzgh/202206/P020220613588246984615.pdf",
    "changchun_logistics": "https://zwgk.changchun.gov.cn/sy/syqrmzfbgs/zfxxgkml/202512/t20251222_3453747.html",
    "green_food": "https://fgs.moa.gov.cn/flfg/202201/t20220127_6387807.htm",
    "county_commerce": "https://dcj.mofcom.gov.cn/article/zcfb/zcgnmy/202106/20210603070393.shtml",
    "green_supply_chain": "https://www.mee.gov.cn/xxgk2018/xxgk/xxgk15/201804/t20180425_630113_wh.html",
    "leading_enterprise": "https://fgs.moa.gov.cn/flfg/202110/t20211026_6380529.htm",
    "digital_agriculture": "https://www.cac.gov.cn/2020-01/21/c_1581145429704893.htm",
}

GENERIC_POLICY_URLS = {
    "https://www.gov.cn/",
    "https://www.npc.gov.cn/",
    "https://www.ndrc.gov.cn/",
    "https://www.samr.gov.cn/",
    "https://www.moa.gov.cn/",
    "https://www.changchun.gov.cn/",
    "https://jtysj.changchun.gov.cn/",
    "https://www.greenfood.org.cn/",
}

PUBLIC_NEWS_DEMO = [
    {
        "news_id": "NEWS-CC-001",
        "title": "吉品食品产业园完成长春市夏季订单协同排产",
        "published_label": "今日 10:20",
        "summary": "园区已将企业订单、产能和运输任务汇总到同一演示看板。",
        "category": "园区动态",
        "tone": "blue",
        "source_type": "DEMO_SIMULATION",
        "source_url": "#",
        "service_scope": "长春市",
    },
    {
        "news_id": "NEWS-CC-002",
        "title": "长春新区团餐集配中心启动冷链联运演示",
        "published_label": "今日 09:45",
        "summary": "两条冷藏线路完成车辆匹配，预计覆盖新区与宽城区重点需求。",
        "category": "物流动态",
        "tone": "green",
        "source_type": "DEMO_SIMULATION",
        "source_url": "#",
        "service_scope": "长春市",
    },
    {
        "news_id": "NEWS-CC-003",
        "title": "净月区社区生鲜订单进入补料提醒",
        "published_label": "昨日 16:30",
        "summary": "净菜企业当前库存低于已审批阈值，已反馈生产计划。",
        "category": "库存预警",
        "tone": "red",
        "source_type": "DEMO_SIMULATION",
        "source_url": "#",
        "service_scope": "长春市",
    },
    {
        "news_id": "NEWS-CC-004",
        "title": "长春市农产品加工企业采购周报发布",
        "published_label": "昨日 14:10",
        "summary": "玉米、大豆、包装材料成为本周集中采购分析的主要品类。",
        "category": "采购分析",
        "tone": "amber",
        "source_type": "DEMO_SIMULATION",
        "source_url": "#",
        "service_scope": "长春市",
    },
]


def public_policy_source(policy: Policy) -> tuple[str, bool, str]:
    original_url = (policy.source_url or "").rstrip("/") + "/" if policy.source_url else ""
    if original_url and original_url not in GENERIC_POLICY_URLS:
        return policy.source_url, True, "原始政策来源"
    text = f"{policy.title} {policy.category} {policy.summary}"
    if "食品安全" in text:
        return PUBLIC_POLICY_LINKS["food_safety"], True, "全国人大国家法律法规数据库：中华人民共和国食品安全法"
    if "绿色供应链" in text or "节能降碳" in text:
        return PUBLIC_POLICY_LINKS["green_supply_chain"], True, "生态环境部等部门：绿色供应链创新与应用"
    if "绿色食品" in text:
        return PUBLIC_POLICY_LINKS["green_food"], True, "农业农村部：绿色食品标志管理办法"
    if "产地冷藏" in text or "农业设施" in text:
        return PUBLIC_POLICY_LINKS["cold_storage"], True, "农业农村部：农产品产地冷藏保鲜设施建设通知"
    if "冷链" in text or "温控" in text:
        return PUBLIC_POLICY_LINKS["cold_chain"], True, "农业农村部：农产品冷藏保鲜设施建设工作通知"
    if "十五五" in text:
        return PUBLIC_POLICY_LINKS["fifteenth_plan"], True, "全国人大：中华人民共和国国民经济和社会发展第十五个五年规划纲要"
    if "东北" in text and "规划" in text:
        return PUBLIC_POLICY_LINKS["northeast_plan"], True, "国家发展改革委：东北振兴“十三五”规划"
    if "东北" in text or "振兴" in text:
        return PUBLIC_POLICY_LINKS["northeast_revitalization"], True, "国家发展改革委：新一轮东北振兴公开政策参考"
    if "县域商业" in text or "商业体系" in text or "农产品流通" in text:
        return PUBLIC_POLICY_LINKS["county_commerce"], True, "商务部：县域商业体系建设与农村消费意见"
    if "龙头企业" in text or "企业培育" in text:
        return PUBLIC_POLICY_LINKS["leading_enterprise"], True, "农业农村部：促进农业产业化龙头企业做大做强"
    if "数字乡村" in text or "数字农业" in text or "供应链数据" in text:
        return PUBLIC_POLICY_LINKS["digital_agriculture"], True, "中央网信办等部门：数字农业农村发展规划"
    if "配送" in text or "物流" in text:
        return PUBLIC_POLICY_LINKS["changchun_logistics"], True, "长春市双阳区政府工作报告：物流与冷链产业部署"
    if "长春" in text or "食品产业" in text:
        return PUBLIC_POLICY_LINKS["changchun_industry"], True, "长春市发展和改革委员会：长春市“十四五”产业体系"
    return policy.source_url, False, "演示来源待核验"


def number(value: Any) -> float:
    return float(value or 0)


def scope_statement(statement: Any, model: type, user: User) -> Any:
    if user.role == "enterprise_admin" and hasattr(model, "enterprise_id"):
        return statement.where(model.enterprise_id.in_(user.enterprise_ids or []))
    return statement


def require_park_admin_for_unscoped(user: User, model: type) -> None:
    if user.role == "enterprise_admin" and not hasattr(model, "enterprise_id"):
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "当前资源没有企业归属，企业管理员不可查看该汇总"})


def paged(items: list[Any], page: int, page_size: int) -> dict[str, Any]:
    start = (page - 1) * page_size
    return {"items": items[start : start + page_size], "total": len(items), "page": page, "page_size": page_size}


def calc_result(status: str, calc_results: Any = None, missing_fields: list[str] | None = None) -> dict[str, Any]:
    return {"calculation_status": status, "missing_fields": missing_fields or [], "calc_results": calc_results if calc_results is not None else {}}


def save_calculation_run(db: Session, user: User, calculation_type: str, input_data: dict[str, Any], result: dict[str, Any], enterprise_id: str | None = None) -> str:
    run_id = f"CALC-{uuid4().hex[:16].upper()}"
    db.add(
        CalculationRun(
            run_id=run_id,
            calculation_type=calculation_type,
            enterprise_id=enterprise_id,
            input_json=jsonable_encoder(input_data),
            result_json=jsonable_encoder(result),
            rules_version="B01-RULES-1.0",
            calculation_status=result["calculation_status"],
            created_by=user.user_id,
            created_at=datetime.now(timezone.utc),
        )
    )
    db.commit()
    return run_id


def accessible_enterprise_ids(db: Session, user: User) -> list[str]:
    if user.role == "enterprise_admin":
        return user.enterprise_ids or []
    return list(db.scalars(select(Enterprise.enterprise_id)))


def production_progress_items(db: Session, user: User) -> list[dict[str, Any]]:
    plans = db.scalars(scope_statement(select(ProductionPlan), ProductionPlan, user)).all()
    return [
        {
            "plan_id": plan.plan_id,
            "enterprise_id": plan.enterprise_id,
            "product_id": plan.product_id,
            "product_name": plan.product_name,
            "planned_quantity": number(plan.planned_quantity),
            "qualified_quantity": number(plan.qualified_quantity),
            "progress": number(plan.qualified_quantity) / number(plan.planned_quantity) if number(plan.planned_quantity) else 0,
            "status": plan.status,
            "anomaly": number(plan.qualified_quantity) > number(plan.planned_quantity),
        }
        for plan in plans
    ]


def freezer_summary_items(db: Session, user: User) -> list[dict[str, Any]]:
    records = db.scalars(scope_statement(select(FreezerRecord), FreezerRecord, user)).all()
    return [
        {
            "freezer_id": record.freezer_id,
            "park_id": record.park_id,
            "enterprise_id": record.enterprise_id,
            "frozen_goods_kg": number(record.frozen_goods_kg),
            "used_volume_m3": number(record.used_volume_m3),
            "total_volume_m3": number(record.total_volume_m3),
            "available_volume_m3": max(number(record.total_volume_m3) - number(record.used_volume_m3), 0),
            "usage_rate": number(record.used_volume_m3) / number(record.total_volume_m3) if number(record.total_volume_m3) else None,
            "over_capacity": number(record.used_volume_m3) > number(record.total_volume_m3),
            "recorded_at": record.recorded_at,
        }
        for record in records
    ]


@router.get("/dashboard/overview", response_model=ResponseEnvelope[dict])
def dashboard_overview(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    status: str | None = None,
    enterprise_id: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> dict:
    del page, page_size, keyword, status, start_at, end_at
    ids = accessible_enterprise_ids(db, user)
    enterprise_filter = Enterprise.enterprise_id.in_(ids) if user.role == "enterprise_admin" else True
    committed_statement = select(ProductionOrder).where(ProductionOrder.status.in_(["CONFIRMED", "IN_PROGRESS", "COMPLETED"]))
    expected_statement = select(Preorder).where(Preorder.status.in_(["DRAFT", "CONFIRMED"]))
    sales_statement = select(SalesOrderLine).where(SalesOrderLine.status == "COMPLETED")
    if user.role == "enterprise_admin":
        committed_statement = committed_statement.where(ProductionOrder.enterprise_id.in_(ids))
        expected_statement = expected_statement.where(Preorder.enterprise_id.in_(ids))
        sales_statement = sales_statement.where(SalesOrderLine.enterprise_id.in_(ids))
    committed_orders = db.scalars(committed_statement).all()
    expected_orders = db.scalars(expected_statement).all()
    sales_records = db.scalars(sales_statement).all()
    alerts_statement = select(InventoryAlert).where(InventoryAlert.status.in_(["OPEN", "ACKNOWLEDGED"]))
    if user.role == "enterprise_admin":
        alerts_statement = alerts_statement.where(InventoryAlert.enterprise_id.in_(ids))
    alert_count = len(db.scalars(alerts_statement).all())
    enterprises = db.scalars(select(Enterprise).where(Enterprise.enterprise_id.in_(ids) if user.role == "enterprise_admin" else True)).all()
    details = []
    for enterprise in enterprises:
        committed = sum(number(item.quantity) for item in committed_orders if item.enterprise_id == enterprise.enterprise_id)
        expected = sum(number(item.quantity) for item in expected_orders if item.enterprise_id == enterprise.enterprise_id)
        sales_amount = sum(number(item.order_amount) for item in sales_records if item.enterprise_id == enterprise.enterprise_id)
        if enterprise_id is None or enterprise.enterprise_id == enterprise_id:
            details.append({"enterprise_id": enterprise.enterprise_id, "enterprise_name": enterprise.enterprise_name, "expected_order_quantity": expected, "committed_order_quantity": committed, "sales_amount": sales_amount})
    counts = {
        "enterprise_count": db.scalar(select(func.count()).select_from(Enterprise).where(enterprise_filter)) or 0,
        "production_plan_count": db.scalar(select(func.count()).select_from(ProductionPlan).where(ProductionPlan.enterprise_id.in_(ids))) or 0,
        "inventory_record_count": db.scalar(select(func.count()).select_from(Inventory).where(Inventory.enterprise_id.in_(ids))) or 0,
        "preorder_count": len(expected_orders),
        "transport_task_count": db.scalar(select(func.count()).select_from(TransportTaskSummary).where(TransportTaskSummary.enterprise_id.in_(ids))) or 0,
        "freezer_count": db.scalar(select(func.count()).select_from(FreezerRecord).where(FreezerRecord.enterprise_id.in_(ids))) or 0,
        "expected_order_quantity": sum(number(item.quantity) for item in expected_orders),
        "committed_order_quantity": sum(number(item.quantity) for item in committed_orders),
        "sales_amount_total": sum(number(item.order_amount) for item in sales_records),
        "inventory_alert_count": alert_count,
        "details": details,
    }
    return response_envelope(counts, trace_id=request.state.trace_id)


@router.get("/dashboard/capacity", response_model=ResponseEnvelope[dict])
def dashboard_capacity(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    status: str | None = None,
    enterprise_id: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> dict:
    del status, start_at, end_at
    statement = scope_statement(select(ProductionPlan), ProductionPlan, user)
    if enterprise_id is not None:
        statement = statement.where(ProductionPlan.enterprise_id == enterprise_id)
    plans = db.scalars(statement).all()
    capacity_records = db.scalars(select(EnterpriseCapacity).where(EnterpriseCapacity.status == "ACTIVE")).all()
    names = {enterprise.enterprise_id: enterprise.enterprise_name for enterprise in db.scalars(select(Enterprise)).all()}
    items = [
        {
            "enterprise_id": plan.enterprise_id,
            "enterprise_name": names.get(plan.enterprise_id, plan.enterprise_id),
            "product_id": plan.product_id,
            "product_name": plan.product_name,
            "capacity_remaining": number(plan.planned_quantity) - number(plan.qualified_quantity),
            "unit": plan.unit,
            "daily_capacity": next((number(capacity.daily_capacity) for capacity in capacity_records if capacity.enterprise_id == plan.enterprise_id and capacity.product_category_id == plan.product_id and capacity.effective_from <= (plan.planned_start_at.date() if plan.planned_start_at else date.today()) and (capacity.effective_to is None or (plan.planned_start_at.date() if plan.planned_start_at else date.today()) <= capacity.effective_to)), None),
            "over_capacity": any(capacity.enterprise_id == plan.enterprise_id and capacity.product_category_id == plan.product_id and number(plan.planned_quantity) > number(capacity.daily_capacity) for capacity in capacity_records),
        }
        for plan in plans
        if keyword is None or keyword.lower() in f"{plan.enterprise_id} {plan.product_id} {plan.product_name}".lower()
    ]
    return response_envelope(paged(items, page, page_size), trace_id=request.state.trace_id)


@router.get("/dashboard/inventory", response_model=ResponseEnvelope[dict])
def dashboard_inventory(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    status: str | None = None,
    enterprise_id: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> dict:
    del status, start_at, end_at
    statement = scope_statement(select(Inventory), Inventory, user)
    if enterprise_id is not None:
        statement = statement.where(Inventory.enterprise_id == enterprise_id)
    records = db.scalars(statement).all()
    thresholds = {item.inventory_record_id: item for item in db.scalars(select(InventoryThresholdRequest).where(InventoryThresholdRequest.status == "APPROVED")).all()}
    alerts = {item.inventory_record_id: item for item in db.scalars(select(InventoryAlert).where(InventoryAlert.status.in_(["OPEN", "ACKNOWLEDGED"]))).all()}
    results = [{"inventory_record_id": record.inventory_record_id, "enterprise_id": record.enterprise_id, "product_id": record.product_id, "current_qty": number(record.current_qty), "inbound_qty": number(record.inbound_qty), "outbound_qty": number(record.outbound_qty), "adjustment_qty": number(record.adjustment_qty), "unit": record.unit, "status": record.status, "safety_stock_qty": number(thresholds[record.inventory_record_id].safety_stock_qty) if record.inventory_record_id in thresholds and thresholds[record.inventory_record_id].safety_stock_qty is not None else None, "inventory_alert_status": alerts[record.inventory_record_id].status if record.inventory_record_id in alerts else None} for record in records if keyword is None or keyword.lower() in f"{record.product_id} {record.product_name}".lower()]
    return response_envelope(paged(results, page, page_size), trace_id=request.state.trace_id)


@router.get("/dashboard/sales", response_model=ResponseEnvelope[dict])
def dashboard_sales(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    status: str | None = None,
    enterprise_id: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> dict:
    del keyword, status, start_at, end_at
    statement = scope_statement(select(SalesOrderLine), SalesOrderLine, user)
    if enterprise_id is not None:
        statement = statement.where(SalesOrderLine.enterprise_id == enterprise_id)
    records = db.scalars(statement).all()
    result = [{"sales_order_id": record.sales_order_id, "line_no": record.line_no, "enterprise_id": record.enterprise_id, "quantity": number(record.quantity), "order_amount": number(record.order_amount), "discount_amount": number(record.discount_amount), "received_amount": number(record.received_amount), "currency": record.currency, "status": record.status} for record in records]
    return response_envelope(paged(result, page, page_size), trace_id=request.state.trace_id)


@router.get("/dashboard/preorders", response_model=ResponseEnvelope[dict])
def dashboard_preorders(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    status: str | None = None,
    enterprise_id: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> dict:
    del status, enterprise_id, start_at, end_at
    require_park_admin_for_unscoped(user, Preorder)
    records = db.scalars(select(Preorder)).all()
    partner_names = {item.partner_id: item.partner_name for item in db.scalars(select(Partner)).all()}
    result = [{"preorder_id": record.preorder_id, "partner_id": record.partner_id, "partner_name": partner_names.get(record.partner_id, record.partner_id), "store_id": record.store_id, "product_id": record.product_id, "product_name": record.product_name, "quantity": number(record.quantity), "unit": record.unit, "required_at": record.required_at, "status": record.status} for record in records if keyword is None or keyword.lower() in f"{record.product_id} {record.product_name}".lower()]
    return response_envelope(paged(result, page, page_size), trace_id=request.state.trace_id)


@router.get("/dashboard/transport", response_model=ResponseEnvelope[dict])
def dashboard_transport(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    status: str | None = None,
    enterprise_id: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> dict:
    del start_at, end_at
    statement = scope_statement(select(TransportTaskSummary), TransportTaskSummary, user)
    if enterprise_id is not None:
        statement = statement.where(TransportTaskSummary.enterprise_id == enterprise_id)
    records = db.scalars(statement).all()
    telemetry = db.scalars(select(TransportTelemetry)).all()
    result = [{"task_id": record.task_id, "order_id": record.order_id, "enterprise_id": record.enterprise_id, "status": record.status, "status_version": record.status_version, "planned_depart_at": record.planned_depart_at, "planned_arrive_at": record.planned_arrive_at, "vehicle_id": record.vehicle_id, "driver_id": record.driver_id, "vehicle_type_id": record.vehicle_type_id, "vehicle_type_name": record.vehicle_type_name, "required_vehicle_count": record.required_vehicle_count, "estimated_fee": number(record.estimated_fee), "currency": record.currency, "telemetry": [record_data(point) for point in telemetry if point.task_id == record.task_id]} for record in records if (status is None or record.status == status) and (keyword is None or keyword.lower() in f"{record.task_id} {record.order_id}".lower())]
    return response_envelope(paged(result, page, page_size), trace_id=request.state.trace_id)


@router.get("/dashboard/freezers", response_model=ResponseEnvelope[dict])
def dashboard_freezers(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    status: str | None = None,
    enterprise_id: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> dict:
    del keyword, status, start_at, end_at
    statement = scope_statement(select(FreezerRecord), FreezerRecord, user)
    if enterprise_id is not None:
        statement = statement.where(FreezerRecord.enterprise_id == enterprise_id)
    records = db.scalars(statement).all()
    items = [{"freezer_id": record.freezer_id, "enterprise_id": record.enterprise_id, "frozen_goods_kg": number(record.frozen_goods_kg), "used_volume_m3": number(record.used_volume_m3), "total_volume_m3": number(record.total_volume_m3), "usage_rate": number(record.used_volume_m3) / number(record.total_volume_m3) if number(record.total_volume_m3) else None, "over_capacity": number(record.used_volume_m3) > number(record.total_volume_m3)} for record in records]
    return response_envelope(paged(items, page, page_size), trace_id=request.state.trace_id)


@router.get("/dashboard/production-progress", response_model=ResponseEnvelope[dict])
def dashboard_production_progress(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    status: str | None = None,
    enterprise_id: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> dict:
    del status, start_at, end_at
    items = production_progress_items(db, user)
    if enterprise_id is not None:
        items = [item for item in items if item["enterprise_id"] == enterprise_id]
    if keyword is not None:
        items = [item for item in items if keyword.lower() in f"{item['plan_id']} {item['product_id']} {item['product_name']}".lower()]
    return response_envelope(paged(items, page, page_size), trace_id=request.state.trace_id)


def active_boms_for(boms: list[Bom], product_id: str, enterprise_id: str, demand_date: date) -> list[Bom]:
    matches = [
        bom
        for bom in boms
        if bom.product_id == product_id
        and bom.status == "ACTIVE"
        and (bom.enterprise_id == enterprise_id or bom.enterprise_id is None)
        and (bom.effective_from is None or bom.effective_from <= demand_date)
        and (bom.effective_to is None or demand_date <= bom.effective_to)
    ]
    enterprise_matches = [bom for bom in matches if bom.enterprise_id == enterprise_id]
    matches = enterprise_matches or [bom for bom in matches if bom.enterprise_id is None]
    if not matches:
        return []
    latest_date = max((bom.effective_from or date.min) for bom in matches)
    latest = [bom for bom in matches if (bom.effective_from or date.min) == latest_date]
    selected_bom_ids = {bom.bom_id for bom in latest}
    return [bom for bom in latest if bom.bom_id in selected_bom_ids]


def material_demand_data(db: Session, user: User) -> tuple[dict[str, Any], list[str]]:
    plans = db.scalars(scope_statement(select(ProductionPlan), ProductionPlan, user)).all()
    plan_ids = {plan.plan_id for plan in plans}
    orders = db.scalars(scope_statement(select(ProductionOrder).where(ProductionOrder.status.in_(["CONFIRMED", "IN_PROGRESS", "COMPLETED"])), ProductionOrder, user)).all()
    quantities: dict[tuple[str, str, str], float] = {}
    sources: dict[str, list[str]] = {}
    for plan in plans:
        key = (plan.enterprise_id, plan.product_id, plan.product_name)
        quantities[key] = quantities.get(key, 0) + number(plan.planned_quantity)
        sources.setdefault(f"{plan.enterprise_id}:{plan.product_id}", []).append(f"PLAN:{plan.plan_id}")
    for order in orders:
        if order.plan_id in plan_ids:
            continue
        key = (order.enterprise_id, order.product_id, order.product_name)
        quantities[key] = quantities.get(key, 0) + number(order.quantity)
        sources.setdefault(f"{order.enterprise_id}:{order.product_id}", []).append(f"ORDER:{order.production_order_id}")
    if not quantities:
        return {}, ["production_plans_or_committed_orders"]
    boms = db.scalars(select(Bom)).all()
    totals: dict[tuple[str, str], dict[str, Any]] = {}
    missing: list[str] = []
    for (enterprise_id, product_id, product_name), quantity in quantities.items():
        demand_date = date.today()
        matching_boms = active_boms_for(boms, product_id, enterprise_id, demand_date)
        if not matching_boms:
            missing.append(f"BOM:{enterprise_id}:{product_id}")
            continue
        for bom in matching_boms:
            key = (bom.material_id, bom.material_name)
            item = totals.setdefault(key, {"material_id": bom.material_id, "material_name": bom.material_name, "quantity": 0.0, "unit": "kg", "enterprise_breakdown": {}})
            amount = quantity * number(bom.unit_usage_kg)
            item["quantity"] += amount
            item["enterprise_breakdown"][enterprise_id] = item["enterprise_breakdown"].get(enterprise_id, 0) + amount
    return {"items": list(totals.values()), "source_count": sum(len(items) for items in sources.values()), "source_items": sources}, missing


@router.get("/analytics/material-demand", response_model=ResponseEnvelope[dict])
def material_demand(request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    result_data, missing = material_demand_data(db, user)
    result = calc_result("DATA_MISSING" if missing else "OK", result_data, missing)
    run_id = save_calculation_run(db, user, "MATERIAL_DEMAND", {}, result)
    result["calc_results"]["run_id"] = run_id
    return response_envelope(result, trace_id=request.state.trace_id)


@router.post("/procurements/aggregate-preview", response_model=ResponseEnvelope[dict])
def aggregate_procurement(request: Request, body: dict[str, Any], db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    start_date = date.fromisoformat(str(body.get("start_date"))) if body.get("start_date") else date.today() - timedelta(days=89)
    end_date = date.fromisoformat(str(body.get("end_date"))) if body.get("end_date") else date.today()
    material_id = body.get("material_id")
    quantity = body.get("quantity")
    demand_data, demand_missing = material_demand_data(db, user)
    if material_id is None:
        if demand_missing:
            result = calc_result("DATA_MISSING", demand_data, demand_missing)
            run_id = save_calculation_run(db, user, "PROCUREMENT_AGGREGATE", body, result)
            result["calc_results"]["run_id"] = run_id
            return response_envelope(result, trace_id=request.state.trace_id)
        material_items = demand_data.get("items", [])
    else:
        material_items = [{"material_id": material_id, "quantity": number(quantity)}]
    output_items: list[dict[str, Any]] = []
    missing: list[str] = []
    for material in material_items:
        item_material_id = material["material_id"]
        requested_quantity = number(quantity) if material_id is not None and quantity is not None else number(material.get("quantity"))
        history_statement = select(ProcurementHistory).where(ProcurementHistory.material_id == item_material_id, ProcurementHistory.status == "VALID", ProcurementHistory.currency == "CNY", ProcurementHistory.purchased_at >= datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc), ProcurementHistory.purchased_at <= datetime.combine(end_date, datetime.max.time(), tzinfo=timezone.utc))
        if user.role == "enterprise_admin":
            history_statement = history_statement.where(ProcurementHistory.enterprise_id.in_(user.enterprise_ids or []))
        history = db.scalars(history_statement).all()
        if not history:
            missing.append(f"PROCUREMENT_HISTORY:{item_material_id}")
            continue
        grouped: dict[tuple[str, str, str], dict[str, float]] = {}
        for record in history:
            key = (record.supplier_id, record.supplier_name, record.supplier_type)
            bucket = grouped.setdefault(key, {"quantity_kg": 0.0, "amount": 0.0})
            bucket["quantity_kg"] += number(record.quantity_kg)
            bucket["amount"] += number(record.quantity_kg) * number(record.unit_price)
        candidates = [{"supplier_id": key[0], "supplier_name": key[1], "supplier_type": key[2], "historical_quantity_kg": values["quantity_kg"], "weighted_average_unit_price": values["amount"] / values["quantity_kg"] if values["quantity_kg"] else None, "requested_quantity_kg": requested_quantity, "currency": "CNY"} for key, values in grouped.items()]
        candidates.sort(key=lambda item: item["weighted_average_unit_price"] if item["weighted_average_unit_price"] is not None else float("inf"))
        output_items.append({"material_id": item_material_id, "material_name": material.get("material_name"), "requested_quantity_kg": requested_quantity, "recommended_supplier": candidates[0] if candidates else None, "candidates": candidates})
    status = "DATA_MISSING" if missing else "OK"
    result = calc_result(status, {"start_date": start_date, "end_date": end_date, "items": output_items}, missing)
    run_id = save_calculation_run(db, user, "PROCUREMENT_AGGREGATE", body, result)
    result["calc_results"]["run_id"] = run_id
    return response_envelope(result, trace_id=request.state.trace_id)


@router.post("/transport-matches/preview", response_model=ResponseEnvelope[dict])
def transport_matches(request: Request, body: dict[str, Any], db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    mass = body.get("mass_capacity_kg", body.get("mass_kg"))
    volume = body.get("volume_capacity_m3", body.get("volume_m3"))
    if mass is None or volume is None:
        return response_envelope(calc_result("DATA_MISSING", {}, ["mass_kg", "volume_m3"]), trace_id=request.state.trace_id)
    resources = db.scalars(select(TransportResource).where(TransportResource.on_duty.is_(True), TransportResource.status == "ACTIVE")).all()
    fee_by_type = {str(option.get("vehicle_type_id")): number(option.get("estimated_fee")) for option in body.get("vehicle_options", []) if option.get("vehicle_type_id")}
    candidates = [resource for resource in resources if (resource.mass_capacity_kg is not None or resource.volume_capacity_m3 is not None)]
    candidates.sort(key=lambda resource: fee_by_type.get(str(resource.vehicle_type_id), number(body.get("estimated_fee_per_vehicle"))))
    selected: list[TransportResource] = []
    total_mass = 0.0
    total_volume = 0.0
    for resource in candidates:
        if total_mass >= number(mass) and total_volume >= number(volume):
            break
        selected.append(resource)
        total_mass += number(resource.mass_capacity_kg)
        total_volume += number(resource.volume_capacity_m3)
    selected_by_type: dict[tuple[str, str], dict[str, Any]] = {}
    for resource in selected:
        key = (resource.vehicle_type_id or "UNKNOWN", resource.vehicle_type_name or "未分类车型")
        item = selected_by_type.setdefault(key, {"vehicle_type_id": key[0], "vehicle_type_name": key[1], "vehicle_count": 0, "estimated_fee": 0.0, "vehicle_ids": []})
        item["vehicle_count"] += 1
        item["estimated_fee"] += fee_by_type.get(str(resource.vehicle_type_id), number(body.get("estimated_fee_per_vehicle")))
        item["vehicle_ids"].append(resource.vehicle_id)
    enough = total_mass >= number(mass) and total_volume >= number(volume)
    result_data = {"required_mass_kg": number(mass), "required_volume_m3": number(volume), "vehicle_count": len(selected), "total_mass_capacity_kg": total_mass, "total_volume_capacity_m3": total_volume, "total_estimated_fee": sum(item["estimated_fee"] for item in selected_by_type.values()), "currency": "CNY", "matches": list(selected_by_type.values()), "shortage_mass_kg": max(number(mass) - total_mass, 0), "shortage_volume_m3": max(number(volume) - total_volume, 0)}
    result = calc_result("OK" if enough else "DATA_MISSING", result_data, [] if enough else ["matching_transport_resource"])
    run_id = save_calculation_run(db, user, "TRANSPORT_MATCH", body, result)
    result["calc_results"]["run_id"] = run_id
    return response_envelope(result, trace_id=request.state.trace_id)


@router.post("/routes/estimate", response_model=ResponseEnvelope[dict])
def estimate_route(request: Request, body: dict[str, Any], user: Annotated[User, Depends(get_current_user)]) -> dict:
    del user
    if not body.get("origin") or not body.get("destination"):
        return response_envelope(calc_result("DATA_MISSING", {}, ["origin", "destination"]), trace_id=request.state.trace_id)
    return response_envelope(calc_result("RULE_MISSING", {}, ["map_provider"]), trace_id=request.state.trace_id)


@router.get("/freezers/summary", response_model=ResponseEnvelope[dict])
def freezer_summary(request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    items = freezer_summary_items(db, user)
    if not items:
        return response_envelope(calc_result("DATA_MISSING", {}, ["freezer_records"]), trace_id=request.state.trace_id)
    return response_envelope(calc_result("OK", {"items": items}), trace_id=request.state.trace_id)


@router.post("/policies/match", response_model=ResponseEnvelope[dict])
def policy_match(request: Request, body: dict[str, Any], db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    tags = {str(tag).lower() for tag in body.get("tags", [])}
    industry = str(body.get("industry", "")).lower()
    if not tags and not industry:
        return response_envelope(calc_result("DATA_MISSING", {}, ["tags", "industry"]), trace_id=request.state.trace_id)
    policies = db.scalars(select(Policy).where(Policy.status == "ACTIVE")).all()
    matches = [record_data(policy) for policy in policies if tags.intersection({str(policy.category).lower(), str(policy.industry or "").lower()}) or (industry and industry in str(policy.industry or "").lower())]
    return response_envelope(calc_result("OK", {"matched": matches, "match_count": len(matches)}), trace_id=request.state.trace_id)


@router.get("/production/progress", response_model=ResponseEnvelope[dict])
def production_progress(request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    items = production_progress_items(db, user)
    if not items:
        return response_envelope(calc_result("DATA_MISSING", {}, ["production_plans"]), trace_id=request.state.trace_id)
    return response_envelope(calc_result("OK", {"items": items}), trace_id=request.state.trace_id)


def public_enterprises(db: Session, park_id: str | None) -> list[Enterprise]:
    statement = select(Enterprise)
    if park_id:
        statement = statement.where(Enterprise.park_id == park_id)
    return db.scalars(statement).all()


@public_router.get("/public/dashboard/overview", response_model=ResponseEnvelope[dict])
def public_overview(request: Request, db: Annotated[Session, Depends(get_db)], park_id: str | None = None, trend_days: int = 7) -> dict:
    enterprises = public_enterprises(db, park_id)
    ids = [enterprise.enterprise_id for enterprise in enterprises]
    plans = db.scalars(select(ProductionPlan).where(ProductionPlan.enterprise_id.in_(ids))).all() if ids else []
    orders = db.scalars(select(ProductionOrder).where(ProductionOrder.enterprise_id.in_(ids), ProductionOrder.status.in_(["CONFIRMED", "IN_PROGRESS", "COMPLETED"]))).all() if ids else []
    sales = db.scalars(select(SalesOrderLine).where(SalesOrderLine.enterprise_id.in_(ids), SalesOrderLine.status == "COMPLETED")).all() if ids else []
    tasks = db.scalars(select(TransportTaskSummary).where(TransportTaskSummary.enterprise_id.in_(ids))).all() if ids else []
    counts: dict[str, int] = {}
    for task in tasks:
        counts[task.status] = counts.get(task.status, 0) + 1
    trend_start = date.today() - timedelta(days=max(trend_days, 1) - 1)
    enterprise_labels = {enterprise.enterprise_id: f"企业-{index:02d}" for index, enterprise in enumerate(enterprises, start=1)}
    order_trend = []
    sales_trend = []
    for offset in range(max(trend_days, 1)):
        current_date = trend_start + timedelta(days=offset)
        order_trend.append({"date": current_date, "quantity": sum(number(order.quantity) for order in orders if order.ordered_at and order.ordered_at.date() == current_date)})
        sales_trend.append({"date": current_date, "amount": sum(number(line.order_amount) for line in sales if line.ordered_at.date() == current_date)})
    order_pie = [{"enterprise_label": enterprise_labels[enterprise.enterprise_id], "committed_order_quantity": sum(number(order.quantity) for order in orders if order.enterprise_id == enterprise.enterprise_id)} for enterprise in enterprises]
    return response_envelope({"park_id": park_id, "enterprise_count": len(enterprises), "capacity_remaining_total": sum(number(plan.planned_quantity) - number(plan.qualified_quantity) for plan in plans), "capacity_unit": "piece", "preorder_quantity_total": 0, "preorder_unit": "piece", "transport_task_counts": counts, "committed_order_quantity_total": sum(number(order.quantity) for order in orders), "sales_amount_total": sum(number(line.order_amount) for line in sales), "enterprise_order_pie": order_pie, "order_trend": order_trend, "sales_trend": sales_trend, "trend_days": trend_days}, trace_id=request.state.trace_id)


@public_router.get("/public/dashboard/capacity", response_model=ResponseEnvelope[list[dict]])
def public_capacity(request: Request, db: Annotated[Session, Depends(get_db)], park_id: str | None = None, start_at: datetime | None = None, end_at: datetime | None = None) -> dict:
    del start_at, end_at
    enterprise_ids = [enterprise.enterprise_id for enterprise in public_enterprises(db, park_id)]
    enterprises = {enterprise_id: f"企业-{index:02d}" for index, enterprise_id in enumerate(enterprise_ids, start=1)}
    plans = db.scalars(select(ProductionPlan).where(ProductionPlan.enterprise_id.in_(enterprises))) if enterprises else []
    items = [{"enterprise_display_name": enterprises[plan.enterprise_id], "category": plan.product_name, "capacity_remaining": number(plan.planned_quantity) - number(plan.qualified_quantity), "unit": plan.unit, "statistic_at": datetime.now(timezone.utc)} for plan in plans]
    return response_envelope(items, trace_id=request.state.trace_id)


@public_router.get("/public/dashboard/preorders", response_model=ResponseEnvelope[list[dict]])
def public_preorders(request: Request, db: Annotated[Session, Depends(get_db)], park_id: str | None = None, start_at: datetime | None = None, end_at: datetime | None = None) -> dict:
    del start_at, end_at
    ids = [enterprise.enterprise_id for enterprise in public_enterprises(db, park_id)]
    records = db.scalars(select(Preorder).where(Preorder.enterprise_id.in_(ids), Preorder.status.in_(["DRAFT", "CONFIRMED"]))).all() if ids else []
    grouped: dict[tuple[str, str], float] = {}
    for record in records:
        key = (record.product_id, record.product_name)
        grouped[key] = grouped.get(key, 0) + number(record.quantity)
    items = [{"product_id": key[0], "product_name": key[1], "quantity": quantity, "unit": "piece"} for key, quantity in grouped.items()]
    return response_envelope(items, trace_id=request.state.trace_id)


@public_router.get("/public/dashboard/transport", response_model=ResponseEnvelope[list[dict]])
def public_transport(request: Request, db: Annotated[Session, Depends(get_db)], park_id: str | None = None, start_at: datetime | None = None, end_at: datetime | None = None) -> dict:
    del start_at, end_at
    ids = [enterprise.enterprise_id for enterprise in public_enterprises(db, park_id)]
    records = db.scalars(select(TransportTaskSummary).where(TransportTaskSummary.enterprise_id.in_(ids))).all() if ids else []
    telemetry = db.scalars(select(TransportTelemetry).where(TransportTelemetry.task_id.in_([record.task_id for record in records]))).all() if records else []
    resources = db.scalars(select(TransportResource)).all()
    resource_by_vehicle = {resource.vehicle_id: resource for resource in resources}
    resource_by_driver = {resource.driver_id: resource for resource in resources}
    telemetry_by_task: dict[str, list[TransportTelemetry]] = {}
    for point in telemetry:
        telemetry_by_task.setdefault(point.task_id, []).append(point)
    items = []
    for record in records:
        points = telemetry_by_task.get(record.task_id, [])
        resource = resource_by_vehicle.get(record.vehicle_id) or resource_by_driver.get(record.driver_id)
        if resource is None:
            resource = next((item for item in resources if any(point.vehicle_id == item.vehicle_id for point in points)), None)
        vehicle_id = record.vehicle_id or (points[0].vehicle_id if points else None) or (resource.vehicle_id if resource else None)
        driver_id = record.driver_id or (resource.driver_id if resource else None)
        items.append({
            "task_id": record.task_id,
            "enterprise_id": record.enterprise_id,
            "status": record.status,
            "planned_depart_at": record.planned_depart_at,
            "planned_arrive_at": record.planned_arrive_at,
            "origin": record.origin,
            "destination": record.destination,
            "vehicle_id": vehicle_id,
            "driver_id": driver_id,
            "resource_status": resource.status if resource else None,
            "vehicle_type_id": record.vehicle_type_id,
            "vehicle_type_name": record.vehicle_type_name or (resource.vehicle_type_name if resource else None),
            "required_vehicle_count": record.required_vehicle_count,
            "estimated_fee": number(record.estimated_fee),
            "currency": record.currency,
            "anomaly": any(point.anomaly_status != "NORMAL" for point in points),
            "path_points": [{"recorded_at": point.recorded_at, "latitude": number(point.latitude), "longitude": number(point.longitude), "anomaly_status": point.anomaly_status, "point_color": "red" if point.anomaly_status != "NORMAL" else "green"} for point in points],
        })
    return response_envelope(items, trace_id=request.state.trace_id)


@public_router.get("/public/dashboard/policies", response_model=ResponseEnvelope[list[dict]])
def public_policies(request: Request, db: Annotated[Session, Depends(get_db)]) -> dict:
    policies = db.scalars(select(Policy).where(Policy.status == "ACTIVE").order_by(Policy.effective_date.desc().nullslast(), Policy.published_date.desc().nullslast())).all()
    items = []
    for policy in policies:
        source_url, source_verified, source_name = public_policy_source(policy)
        items.append({"policy_id": policy.policy_id, "title": policy.title, "category": policy.category, "summary": policy.summary, "source_url": source_url, "source_type": policy.source_type or "OFFICIAL", "source_verified": source_verified, "source_name": source_name, "published_date": policy.published_date, "effective_date": policy.effective_date})
    return response_envelope(items, trace_id=request.state.trace_id)


@public_router.get("/public/dashboard/news", response_model=ResponseEnvelope[list[dict]])
def public_news(request: Request) -> dict:
    return response_envelope(PUBLIC_NEWS_DEMO, trace_id=request.state.trace_id)
