from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes.master_data import record_data
from app.db.session import get_db
from app.models.business_records import Inventory, SalesOrderLine
from app.models.master_data import Enterprise, Partner
from app.models.planning_records import Policy, Preorder, SupplierQuote
from app.models.production import Bom, ProductionPlan
from app.models.transport import FreezerRecord, TransportResource, TransportTaskSummary
from app.models.user import User
from app.schemas.common import ResponseEnvelope, response_envelope

router = APIRouter(tags=["E01 Analytics"])
public_router = APIRouter(tags=["E02 Public Dashboard"])


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
    del page, page_size, keyword, status, enterprise_id, start_at, end_at
    ids = accessible_enterprise_ids(db, user)
    enterprise_filter = Enterprise.enterprise_id.in_(ids) if user.role == "enterprise_admin" else True
    counts = {
        "enterprise_count": db.scalar(select(func.count()).select_from(Enterprise).where(enterprise_filter)) or 0,
        "production_plan_count": db.scalar(select(func.count()).select_from(ProductionPlan).where(ProductionPlan.enterprise_id.in_(ids))) or 0,
        "inventory_record_count": db.scalar(select(func.count()).select_from(Inventory).where(Inventory.enterprise_id.in_(ids))) or 0,
        "preorder_count": 0 if user.role == "enterprise_admin" else (db.scalar(select(func.count()).select_from(Preorder)) or 0),
        "transport_task_count": db.scalar(select(func.count()).select_from(TransportTaskSummary).where(TransportTaskSummary.enterprise_id.in_(ids))) or 0,
        "freezer_count": db.scalar(select(func.count()).select_from(FreezerRecord).where(FreezerRecord.enterprise_id.in_(ids))) or 0,
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
    names = {enterprise.enterprise_id: enterprise.enterprise_name for enterprise in db.scalars(select(Enterprise)).all()}
    items = [
        {
            "enterprise_id": plan.enterprise_id,
            "enterprise_name": names.get(plan.enterprise_id, plan.enterprise_id),
            "product_id": plan.product_id,
            "product_name": plan.product_name,
            "capacity_remaining": number(plan.planned_quantity) - number(plan.qualified_quantity),
            "unit": plan.unit,
            "over_capacity": number(plan.qualified_quantity) > number(plan.planned_quantity),
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
    results = [{"inventory_record_id": record.inventory_record_id, "enterprise_id": record.enterprise_id, "product_id": record.product_id, "current_qty": number(record.current_qty), "inbound_qty": number(record.inbound_qty), "outbound_qty": number(record.outbound_qty), "adjustment_qty": number(record.adjustment_qty), "unit": record.unit, "status": record.status} for record in records if keyword is None or keyword.lower() in f"{record.product_id} {record.product_name}".lower()]
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
    result = [{"task_id": record.task_id, "order_id": record.order_id, "enterprise_id": record.enterprise_id, "status": record.status, "status_version": record.status_version, "planned_depart_at": record.planned_depart_at, "planned_arrive_at": record.planned_arrive_at, "vehicle_id": record.vehicle_id, "driver_id": record.driver_id} for record in records if (status is None or record.status == status) and (keyword is None or keyword.lower() in f"{record.task_id} {record.order_id}".lower())]
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


@router.get("/analytics/material-demand", response_model=ResponseEnvelope[dict])
def material_demand(request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    plans = db.scalars(scope_statement(select(ProductionPlan), ProductionPlan, user)).all()
    if not plans:
        return response_envelope(calc_result("DATA_MISSING", {}, ["production_plans"]), trace_id=request.state.trace_id)
    boms = db.scalars(select(Bom)).all()
    totals: dict[tuple[str, str], float] = {}
    missing: list[str] = []
    for plan in plans:
        matches = [bom for bom in boms if bom.product_id == plan.product_id and (bom.enterprise_id == plan.enterprise_id or bom.enterprise_id is None)]
        if not matches:
            missing.append(f"BOM:{plan.enterprise_id}:{plan.product_id}")
            continue
        for bom in matches:
            key = (bom.material_id, bom.material_name)
            totals[key] = totals.get(key, 0) + number(plan.planned_quantity) * number(bom.unit_usage_kg)
    if missing:
        return response_envelope(calc_result("DATA_MISSING", {"items": [{"material_id": key[0], "material_name": key[1], "quantity": value, "unit": "kg"} for key, value in totals.items()]}, missing), trace_id=request.state.trace_id)
    return response_envelope(calc_result("OK", {"items": [{"material_id": key[0], "material_name": key[1], "quantity": value, "unit": "kg"} for key, value in totals.items()]}), trace_id=request.state.trace_id)


@router.post("/procurements/aggregate-preview", response_model=ResponseEnvelope[dict])
def aggregate_procurement(request: Request, body: dict[str, Any], db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    material_id = body.get("material_id")
    quantity = body.get("quantity")
    if not material_id or quantity is None:
        return response_envelope(calc_result("DATA_MISSING", {}, ["material_id", "quantity"]), trace_id=request.state.trace_id)
    quotes = db.scalars(select(SupplierQuote).where(SupplierQuote.material_id == material_id, SupplierQuote.status == "ACTIVE", SupplierQuote.currency == "CNY")).all()
    if not quotes:
        return response_envelope(calc_result("DATA_MISSING", {}, ["active_supplier_quotes"]), trace_id=request.state.trace_id)
    result = [{"supplier_id": quote.supplier_id, "supplier_name": quote.supplier_name, "tier_id": quote.tier_id, "capacity_kg": number(quote.capacity_kg), "unit_price": number(quote.unit_price), "currency": quote.currency, "requested_quantity": number(quantity)} for quote in sorted(quotes, key=lambda item: number(item.unit_price))]
    return response_envelope(calc_result("OK", {"material_id": material_id, "requested_quantity": number(quantity), "candidates": result}), trace_id=request.state.trace_id)


@router.post("/transport-matches/preview", response_model=ResponseEnvelope[dict])
def transport_matches(request: Request, body: dict[str, Any], db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    mass = body.get("mass_capacity_kg", body.get("mass_kg"))
    volume = body.get("volume_capacity_m3", body.get("volume_m3"))
    if mass is None or volume is None:
        return response_envelope(calc_result("DATA_MISSING", {}, ["mass_kg", "volume_m3"]), trace_id=request.state.trace_id)
    resources = db.scalars(select(TransportResource).where(TransportResource.on_duty.is_(True), TransportResource.status == "ACTIVE")).all()
    candidates = [record_data(resource) for resource in resources if (resource.mass_capacity_kg is None or number(resource.mass_capacity_kg) >= number(mass)) and (resource.volume_capacity_m3 is None or number(resource.volume_capacity_m3) >= number(volume))]
    return response_envelope(calc_result("OK" if candidates else "DATA_MISSING", {"candidates": candidates}, [] if candidates else ["matching_transport_resource"]), trace_id=request.state.trace_id)


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
def public_overview(request: Request, db: Annotated[Session, Depends(get_db)], park_id: str | None = None, start_at: datetime | None = None, end_at: datetime | None = None) -> dict:
    del start_at, end_at
    enterprises = public_enterprises(db, park_id)
    ids = [enterprise.enterprise_id for enterprise in enterprises]
    plans = db.scalars(select(ProductionPlan).where(ProductionPlan.enterprise_id.in_(ids))).all() if ids else []
    tasks = db.scalars(select(TransportTaskSummary).where(TransportTaskSummary.enterprise_id.in_(ids))).all() if ids else []
    counts: dict[str, int] = {}
    for task in tasks:
        counts[task.status] = counts.get(task.status, 0) + 1
    return response_envelope({"park_id": park_id, "enterprise_count": len(enterprises), "capacity_remaining_total": sum(number(plan.planned_quantity) - number(plan.qualified_quantity) for plan in plans), "capacity_unit": "piece", "preorder_quantity_total": 0, "preorder_unit": "piece", "transport_task_counts": counts}, trace_id=request.state.trace_id)


@public_router.get("/public/dashboard/capacity", response_model=ResponseEnvelope[list[dict]])
def public_capacity(request: Request, db: Annotated[Session, Depends(get_db)], park_id: str | None = None, start_at: datetime | None = None, end_at: datetime | None = None) -> dict:
    del start_at, end_at
    enterprises = {enterprise.enterprise_id: enterprise.enterprise_name for enterprise in public_enterprises(db, park_id)}
    plans = db.scalars(select(ProductionPlan).where(ProductionPlan.enterprise_id.in_(enterprises))) if enterprises else []
    items = [{"enterprise_display_name": enterprises[plan.enterprise_id], "category": plan.product_name, "capacity_remaining": number(plan.planned_quantity) - number(plan.qualified_quantity), "unit": plan.unit, "statistic_at": datetime.now(timezone.utc)} for plan in plans]
    return response_envelope(items, trace_id=request.state.trace_id)


@public_router.get("/public/dashboard/preorders", response_model=ResponseEnvelope[list[dict]])
def public_preorders(request: Request, db: Annotated[Session, Depends(get_db)], park_id: str | None = None, start_at: datetime | None = None, end_at: datetime | None = None) -> dict:
    del db, park_id, start_at, end_at
    # 预订单没有企业/园区归属字段，公开端不能把跨园区数据混成一个列表。
    return response_envelope([], trace_id=request.state.trace_id)


@public_router.get("/public/dashboard/transport", response_model=ResponseEnvelope[list[dict]])
def public_transport(request: Request, db: Annotated[Session, Depends(get_db)], park_id: str | None = None, start_at: datetime | None = None, end_at: datetime | None = None) -> dict:
    del start_at, end_at
    ids = [enterprise.enterprise_id for enterprise in public_enterprises(db, park_id)]
    records = db.scalars(select(TransportTaskSummary).where(TransportTaskSummary.enterprise_id.in_(ids))) if ids else []
    items = [{"task_id": record.task_id, "status": record.status, "planned_depart_at": record.planned_depart_at, "planned_arrive_at": record.planned_arrive_at} for record in records]
    return response_envelope(items, trace_id=request.state.trace_id)
