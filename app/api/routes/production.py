from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes.master_data import (
    ensure_enterprise_access,
    ensure_event,
    ensure_event_id_available,
    ensure_version,
    list_records,
    record_data,
    write_metadata,
)
from app.db.session import get_db
from app.models.production import Bom, ProductionOrder, ProductionPlan
from app.models.user import User
from app.schemas.common import EventRequest, ResponseEnvelope, response_envelope
from app.schemas.production import (
    BomCreate,
    BomPatch,
    ProductionOrderCreate,
    ProductionOrderPatch,
    ProductionPlanCreate,
    ProductionPlanPatch,
)

router = APIRouter(tags=["E01 Resources"])


def ensure_patch(changes: dict[str, Any], required_fields: tuple[str, ...]) -> None:
    if not changes:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "PATCH 至少需要一个字段"})
    invalid = [field for field in required_fields if field in changes and changes[field] is None]
    if invalid:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": f"字段不可为空: {', '.join(invalid)}"})


def ensure_bom_access(user: User, enterprise_id: str | None) -> None:
    if enterprise_id is None:
        if user.role != "park_admin":
            raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "只有园区管理员可以维护通用 BOM"})
        return
    ensure_enterprise_access(user, enterprise_id)


@router.get("/production-plans", response_model=ResponseEnvelope[dict])
def list_production_plans(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    status: str | None = None,
) -> dict:
    data = list_records(
        db,
        ProductionPlan,
        user,
        page,
        page_size,
        keyword,
        status,
        scope_field=ProductionPlan.enterprise_id,
        keyword_fields=(ProductionPlan.plan_id, ProductionPlan.product_id, ProductionPlan.product_name),
        status_field=ProductionPlan.status,
    )
    return response_envelope(data, trace_id=request.state.trace_id)


@router.post("/production-plans", response_model=ResponseEnvelope[dict], status_code=201)
def create_production_plan(
    request: Request,
    event: EventRequest[ProductionPlanCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "production_plan")
    ensure_enterprise_access(user, event.payload.enterprise_id)
    ensure_event_id_available(db, ProductionPlan, event.event_id)
    if db.get(ProductionPlan, event.payload.plan_id) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "plan_id 已存在"})
    record = ProductionPlan(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/production-plans/{plan_id}", response_model=ResponseEnvelope[dict])
def get_production_plan(
    request: Request,
    plan_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    record = db.get(ProductionPlan, plan_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "生产计划不存在"})
    ensure_enterprise_access(user, record.enterprise_id)
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/production-plans/{plan_id}", response_model=ResponseEnvelope[dict])
def update_production_plan(
    request: Request,
    plan_id: str,
    event: EventRequest[ProductionPlanPatch],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "production_plan")
    record = db.get(ProductionPlan, plan_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "生产计划不存在"})
    ensure_enterprise_access(user, record.enterprise_id)
    changes = event.payload.model_dump(exclude_unset=True)
    ensure_patch(changes, ("enterprise_id", "product_id", "product_name", "planned_quantity", "unit", "status"))
    target_enterprise_id = changes.get("enterprise_id", record.enterprise_id)
    ensure_enterprise_access(user, target_enterprise_id)
    ensure_version(record, event.object_version)
    for key, value in changes.items():
        setattr(record, key, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/production-orders", response_model=ResponseEnvelope[dict])
def list_production_orders(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    status: str | None = None,
) -> dict:
    data = list_records(
        db,
        ProductionOrder,
        user,
        page,
        page_size,
        keyword,
        status,
        scope_field=ProductionOrder.enterprise_id,
        keyword_fields=(ProductionOrder.production_order_id, ProductionOrder.product_id, ProductionOrder.product_name),
        status_field=ProductionOrder.status,
    )
    return response_envelope(data, trace_id=request.state.trace_id)


@router.post("/production-orders", response_model=ResponseEnvelope[dict], status_code=201)
def create_production_order(
    request: Request,
    event: EventRequest[ProductionOrderCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "production_order")
    ensure_enterprise_access(user, event.payload.enterprise_id)
    ensure_event_id_available(db, ProductionOrder, event.event_id)
    if db.get(ProductionOrder, event.payload.production_order_id) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "production_order_id 已存在"})
    record = ProductionOrder(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/production-orders/{production_order_id}", response_model=ResponseEnvelope[dict])
def get_production_order(
    request: Request,
    production_order_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    record = db.get(ProductionOrder, production_order_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "生产订单不存在"})
    ensure_enterprise_access(user, record.enterprise_id)
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/production-orders/{production_order_id}", response_model=ResponseEnvelope[dict])
def update_production_order(
    request: Request,
    production_order_id: str,
    event: EventRequest[ProductionOrderPatch],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "production_order")
    record = db.get(ProductionOrder, production_order_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "生产订单不存在"})
    ensure_enterprise_access(user, record.enterprise_id)
    changes = event.payload.model_dump(exclude_unset=True)
    ensure_patch(changes, ("enterprise_id", "product_id", "product_name", "quantity", "unit", "status"))
    target_enterprise_id = changes.get("enterprise_id", record.enterprise_id)
    ensure_enterprise_access(user, target_enterprise_id)
    ensure_version(record, event.object_version)
    for key, value in changes.items():
        setattr(record, key, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/boms", response_model=ResponseEnvelope[dict])
def list_boms(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    status: str | None = None,
) -> dict:
    data = list_records(
        db,
        Bom,
        user,
        page,
        page_size,
        keyword,
        status,
        scope_field=Bom.enterprise_id,
        keyword_fields=(Bom.bom_id, Bom.product_id, Bom.product_name, Bom.material_id, Bom.material_name),
        status_field=Bom.status,
    )
    return response_envelope(data, trace_id=request.state.trace_id)


@router.post("/boms", response_model=ResponseEnvelope[dict], status_code=201)
def create_bom(
    request: Request,
    event: EventRequest[BomCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "bom")
    ensure_bom_access(user, event.payload.enterprise_id)
    ensure_event_id_available(db, Bom, event.event_id)
    key = {"bom_id": event.payload.bom_id, "product_id": event.payload.product_id, "material_id": event.payload.material_id}
    if db.get(Bom, key) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "BOM 业务键已存在"})
    record = Bom(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/boms/{bom_id}/{product_id}/{material_id}", response_model=ResponseEnvelope[dict])
def get_bom(
    request: Request,
    bom_id: str,
    product_id: str,
    material_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    record = db.get(Bom, {"bom_id": bom_id, "product_id": product_id, "material_id": material_id})
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "BOM 不存在"})
    ensure_bom_access(user, record.enterprise_id)
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/boms/{bom_id}/{product_id}/{material_id}", response_model=ResponseEnvelope[dict])
def update_bom(
    request: Request,
    bom_id: str,
    product_id: str,
    material_id: str,
    event: EventRequest[BomPatch],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "bom")
    key = {"bom_id": bom_id, "product_id": product_id, "material_id": material_id}
    record = db.get(Bom, key)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "BOM 不存在"})
    ensure_bom_access(user, record.enterprise_id)
    changes = event.payload.model_dump(exclude_unset=True)
    ensure_patch(changes, ("product_name", "material_name", "unit_usage_kg", "unit_usage_unit", "status"))
    target_enterprise_id = changes.get("enterprise_id", record.enterprise_id)
    ensure_bom_access(user, target_enterprise_id)
    ensure_version(record, event.object_version)
    for field, value in changes.items():
        setattr(record, field, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)
