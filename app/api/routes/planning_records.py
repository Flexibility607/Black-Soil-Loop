from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes.master_data import (
    ensure_enterprise_access,
    ensure_event,
    ensure_event_id_available,
    ensure_version,
    record_data,
    write_metadata,
)
from app.db.session import get_db
from app.models.planning_records import Policy, Preorder, ProcurementDemand, SupplierQuote
from app.models.user import User
from app.schemas.common import EventRequest, ResponseEnvelope, response_envelope
from app.schemas.planning_records import (
    PolicyCreate,
    PolicyPatch,
    PreorderCreate,
    PreorderPatch,
    ProcurementDemandCreate,
    ProcurementDemandPatch,
    SupplierQuoteCreate,
    SupplierQuotePatch,
)

router = APIRouter(tags=["E01 Resources"])


def ensure_patch(changes: dict[str, Any], required_fields: tuple[str, ...]) -> None:
    if not changes:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "PATCH 至少需要一个字段"})
    invalid = [field for field in required_fields if field in changes and changes[field] is None]
    if invalid:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": f"字段不可为空: {', '.join(invalid)}"})


def ensure_park_admin(user: User) -> None:
    if user.role != "park_admin":
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "只有园区管理员可以执行此操作"})


def list_records(
    db: Session,
    model: type,
    user: User,
    page: int,
    page_size: int,
    keyword: str | None,
    status: str | None,
    enterprise_id: str | None,
    start_at: datetime | None,
    end_at: datetime | None,
    *,
    scope_field: Any | None,
    keyword_fields: tuple[Any, ...],
    status_field: Any,
    time_field: Any,
) -> dict[str, Any]:
    if scope_field is None:
        ensure_park_admin(user)
    elif user.role == "enterprise_admin" and enterprise_id is not None:
        ensure_enterprise_access(user, enterprise_id)
    statement = select(model)
    if user.role == "enterprise_admin" and scope_field is not None:
        statement = statement.where(scope_field.in_(user.enterprise_ids or []))
    if enterprise_id is not None and scope_field is not None:
        statement = statement.where(scope_field == enterprise_id)
    if keyword:
        statement = statement.where(or_(*(field.ilike(f"%{keyword}%") for field in keyword_fields)))
    if status:
        statement = statement.where(status_field == status)
    if start_at is not None:
        statement = statement.where(time_field >= start_at)
    if end_at is not None:
        statement = statement.where(time_field <= end_at)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    items = db.scalars(statement.offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [record_data(item) for item in items], "total": total, "page": page, "page_size": page_size}


@router.get("/preorders", response_model=ResponseEnvelope[dict])
def list_preorders(
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
    del enterprise_id
    data = list_records(
        db,
        Preorder,
        user,
        page,
        page_size,
        keyword,
        status,
        None,
        start_at,
        end_at,
        scope_field=None,
        keyword_fields=(Preorder.preorder_id, Preorder.partner_id, Preorder.store_id, Preorder.product_id, Preorder.product_name),
        status_field=Preorder.status,
        time_field=Preorder.required_at,
    )
    return response_envelope(data, trace_id=request.state.trace_id)


@router.post("/preorders", response_model=ResponseEnvelope[dict], status_code=201)
def create_preorder(
    request: Request,
    event: EventRequest[PreorderCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_park_admin(user)
    ensure_event(event, "preorder")
    ensure_event_id_available(db, Preorder, event.event_id)
    if db.get(Preorder, event.payload.preorder_id) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "preorder_id 已存在"})
    record = Preorder(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/preorders/{preorder_id}", response_model=ResponseEnvelope[dict])
def get_preorder(
    request: Request,
    preorder_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_park_admin(user)
    record = db.get(Preorder, preorder_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "预订单不存在"})
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/preorders/{preorder_id}", response_model=ResponseEnvelope[dict])
def update_preorder(
    request: Request,
    preorder_id: str,
    event: EventRequest[PreorderPatch],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_park_admin(user)
    ensure_event(event, "preorder")
    record = db.get(Preorder, preorder_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "预订单不存在"})
    changes = event.payload.model_dump(exclude_unset=True)
    ensure_patch(changes, ("partner_id", "store_id", "product_id", "product_name", "quantity", "unit", "required_at", "source_type", "status", "created_at", "updated_at"))
    ensure_version(record, event.object_version)
    for key, value in changes.items():
        setattr(record, key, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/procurement-demands", response_model=ResponseEnvelope[dict])
def list_procurement_demands(
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
    data = list_records(
        db,
        ProcurementDemand,
        user,
        page,
        page_size,
        keyword,
        status,
        enterprise_id,
        start_at,
        end_at,
        scope_field=ProcurementDemand.enterprise_id,
        keyword_fields=(ProcurementDemand.demand_id, ProcurementDemand.material_id, ProcurementDemand.material_name),
        status_field=ProcurementDemand.status,
        time_field=ProcurementDemand.created_at,
    )
    return response_envelope(data, trace_id=request.state.trace_id)


@router.post("/procurement-demands", response_model=ResponseEnvelope[dict], status_code=201)
def create_procurement_demand(
    request: Request,
    event: EventRequest[ProcurementDemandCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "procurement_demand")
    ensure_enterprise_access(user, event.payload.enterprise_id)
    ensure_event_id_available(db, ProcurementDemand, event.event_id)
    if db.get(ProcurementDemand, event.payload.demand_id) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "demand_id 已存在"})
    record = ProcurementDemand(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/procurement-demands/{demand_id}", response_model=ResponseEnvelope[dict])
def get_procurement_demand(
    request: Request,
    demand_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    record = db.get(ProcurementDemand, demand_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "采购需求不存在"})
    ensure_enterprise_access(user, record.enterprise_id)
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/procurement-demands/{demand_id}", response_model=ResponseEnvelope[dict])
def update_procurement_demand(
    request: Request,
    demand_id: str,
    event: EventRequest[ProcurementDemandPatch],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "procurement_demand")
    record = db.get(ProcurementDemand, demand_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "采购需求不存在"})
    ensure_enterprise_access(user, record.enterprise_id)
    changes = event.payload.model_dump(exclude_unset=True)
    ensure_patch(changes, ("enterprise_id", "material_id", "material_name", "demand_quantity", "unit", "period_start", "period_end", "source_type", "status", "created_at"))
    target_enterprise_id = changes.get("enterprise_id", record.enterprise_id)
    ensure_enterprise_access(user, target_enterprise_id)
    ensure_version(record, event.object_version)
    for key, value in changes.items():
        setattr(record, key, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/supplier-quotes", response_model=ResponseEnvelope[dict])
def list_supplier_quotes(
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
    del enterprise_id
    data = list_records(
        db,
        SupplierQuote,
        user,
        page,
        page_size,
        keyword,
        status,
        None,
        start_at,
        end_at,
        scope_field=None,
        keyword_fields=(SupplierQuote.supplier_id, SupplierQuote.supplier_name, SupplierQuote.material_id, SupplierQuote.material_name, SupplierQuote.tier_id),
        status_field=SupplierQuote.status,
        time_field=SupplierQuote.source_updated_at,
    )
    return response_envelope(data, trace_id=request.state.trace_id)


@router.post("/supplier-quotes", response_model=ResponseEnvelope[dict], status_code=201)
def create_supplier_quote(
    request: Request,
    event: EventRequest[SupplierQuoteCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_park_admin(user)
    ensure_event(event, "supplier_quote")
    ensure_event_id_available(db, SupplierQuote, event.event_id)
    key = {"supplier_id": event.payload.supplier_id, "material_id": event.payload.material_id, "tier_id": event.payload.tier_id}
    if db.get(SupplierQuote, key) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "供应商报价业务键已存在"})
    record = SupplierQuote(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/supplier-quotes/{supplier_id}/{material_id}/{tier_id}", response_model=ResponseEnvelope[dict])
def get_supplier_quote(
    request: Request,
    supplier_id: str,
    material_id: str,
    tier_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_park_admin(user)
    record = db.get(SupplierQuote, {"supplier_id": supplier_id, "material_id": material_id, "tier_id": tier_id})
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "供应商报价不存在"})
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/supplier-quotes/{supplier_id}/{material_id}/{tier_id}", response_model=ResponseEnvelope[dict])
def update_supplier_quote(
    request: Request,
    supplier_id: str,
    material_id: str,
    tier_id: str,
    event: EventRequest[SupplierQuotePatch],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_park_admin(user)
    ensure_event(event, "supplier_quote")
    record = db.get(SupplierQuote, {"supplier_id": supplier_id, "material_id": material_id, "tier_id": tier_id})
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "供应商报价不存在"})
    changes = event.payload.model_dump(exclude_unset=True)
    ensure_patch(changes, ("supplier_name", "material_name", "minimum_kg", "unit_price", "currency", "status"))
    ensure_version(record, event.object_version)
    for key, value in changes.items():
        setattr(record, key, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/policies", response_model=ResponseEnvelope[dict])
def list_policies(
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
    del enterprise_id
    data = list_records(
        db,
        Policy,
        user,
        page,
        page_size,
        keyword,
        status,
        None,
        start_at,
        end_at,
        scope_field=None,
        keyword_fields=(Policy.policy_id, Policy.title, Policy.category, Policy.summary),
        status_field=Policy.status,
        time_field=Policy.source_updated_at,
    )
    return response_envelope(data, trace_id=request.state.trace_id)


@router.post("/policies", response_model=ResponseEnvelope[dict], status_code=201)
def create_policy(
    request: Request,
    event: EventRequest[PolicyCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_park_admin(user)
    ensure_event(event, "policy")
    ensure_event_id_available(db, Policy, event.event_id)
    if db.get(Policy, event.payload.policy_id) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "policy_id 已存在"})
    record = Policy(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/policies/{policy_id}", response_model=ResponseEnvelope[dict])
def get_policy(
    request: Request,
    policy_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_park_admin(user)
    record = db.get(Policy, policy_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "政策记录不存在"})
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/policies/{policy_id}", response_model=ResponseEnvelope[dict])
def update_policy(
    request: Request,
    policy_id: str,
    event: EventRequest[PolicyPatch],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_park_admin(user)
    ensure_event(event, "policy")
    record = db.get(Policy, policy_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "政策记录不存在"})
    changes = event.payload.model_dump(exclude_unset=True)
    ensure_patch(changes, ("title", "category", "summary", "source_url", "status"))
    ensure_version(record, event.object_version)
    for key, value in changes.items():
        setattr(record, key, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)
