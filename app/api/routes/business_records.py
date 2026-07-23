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
from app.models.business_records import Inventory, ReturnRecord, SalesOrderLine
from app.models.user import User
from app.schemas.business_records import (
    InventoryCreate,
    InventoryPatch,
    ReturnRecordCreate,
    ReturnRecordPatch,
    SalesOrderLineCreate,
    SalesOrderLinePatch,
)
from app.schemas.common import EventRequest, ResponseEnvelope, response_envelope

router = APIRouter(tags=["E01 Resources"])


def ensure_patch(changes: dict[str, Any], required_fields: tuple[str, ...]) -> None:
    if not changes:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "PATCH 至少需要一个字段"})
    invalid = [field for field in required_fields if field in changes and changes[field] is None]
    if invalid:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": f"字段不可为空: {', '.join(invalid)}"})


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
    keyword_fields: tuple[Any, ...],
    status_field: Any,
    time_field: Any,
) -> dict[str, Any]:
    if enterprise_id is not None:
        ensure_enterprise_access(user, enterprise_id)
    statement = select(model)
    if user.role == "enterprise_admin":
        statement = statement.where(model.enterprise_id.in_(user.enterprise_ids or []))
    if enterprise_id is not None:
        statement = statement.where(model.enterprise_id == enterprise_id)
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


def ensure_required_changes(changes: dict[str, Any], required_fields: tuple[str, ...]) -> None:
    ensure_patch(changes, required_fields)


@router.get("/inventories", response_model=ResponseEnvelope[dict])
def list_inventories(
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
        Inventory,
        user,
        page,
        page_size,
        keyword,
        status,
        enterprise_id,
        start_at,
        end_at,
        keyword_fields=(Inventory.inventory_record_id, Inventory.warehouse_id, Inventory.product_id, Inventory.product_name),
        status_field=Inventory.status,
        time_field=Inventory.recorded_at,
    )
    return response_envelope(data, trace_id=request.state.trace_id)


@router.post("/inventories", response_model=ResponseEnvelope[dict], status_code=201)
def create_inventory(
    request: Request,
    event: EventRequest[InventoryCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "inventory")
    ensure_enterprise_access(user, event.payload.enterprise_id)
    ensure_event_id_available(db, Inventory, event.event_id)
    if db.get(Inventory, event.payload.inventory_record_id) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "inventory_record_id 已存在"})
    record = Inventory(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/inventories/{inventory_record_id}", response_model=ResponseEnvelope[dict])
def get_inventory(
    request: Request,
    inventory_record_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    record = db.get(Inventory, inventory_record_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "库存记录不存在"})
    ensure_enterprise_access(user, record.enterprise_id)
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/inventories/{inventory_record_id}", response_model=ResponseEnvelope[dict])
def update_inventory(
    request: Request,
    inventory_record_id: str,
    event: EventRequest[InventoryPatch],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "inventory")
    record = db.get(Inventory, inventory_record_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "库存记录不存在"})
    ensure_enterprise_access(user, record.enterprise_id)
    changes = event.payload.model_dump(exclude_unset=True)
    ensure_required_changes(changes, ("enterprise_id", "warehouse_id", "product_id", "product_name", "category_id", "unit", "current_qty", "recorded_at", "status"))
    target_enterprise_id = changes.get("enterprise_id", record.enterprise_id)
    ensure_enterprise_access(user, target_enterprise_id)
    ensure_version(record, event.object_version)
    for key, value in changes.items():
        setattr(record, key, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/sales-order-lines", response_model=ResponseEnvelope[dict])
def list_sales_order_lines(
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
        SalesOrderLine,
        user,
        page,
        page_size,
        keyword,
        status,
        enterprise_id,
        start_at,
        end_at,
        keyword_fields=(SalesOrderLine.sales_order_id, SalesOrderLine.product_id, SalesOrderLine.product_name),
        status_field=SalesOrderLine.status,
        time_field=SalesOrderLine.ordered_at,
    )
    return response_envelope(data, trace_id=request.state.trace_id)


@router.post("/sales-order-lines", response_model=ResponseEnvelope[dict], status_code=201)
def create_sales_order_line(
    request: Request,
    event: EventRequest[SalesOrderLineCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "sales_order_line")
    ensure_enterprise_access(user, event.payload.enterprise_id)
    ensure_event_id_available(db, SalesOrderLine, event.event_id)
    key = {"sales_order_id": event.payload.sales_order_id, "line_no": event.payload.line_no}
    if db.get(SalesOrderLine, key) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "销售订单明细业务键已存在"})
    record = SalesOrderLine(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/sales-order-lines/{sales_order_id}/{line_no}", response_model=ResponseEnvelope[dict])
def get_sales_order_line(
    request: Request,
    sales_order_id: str,
    line_no: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    record = db.get(SalesOrderLine, {"sales_order_id": sales_order_id, "line_no": line_no})
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "销售订单明细不存在"})
    ensure_enterprise_access(user, record.enterprise_id)
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/sales-order-lines/{sales_order_id}/{line_no}", response_model=ResponseEnvelope[dict])
def update_sales_order_line(
    request: Request,
    sales_order_id: str,
    line_no: int,
    event: EventRequest[SalesOrderLinePatch],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "sales_order_line")
    record = db.get(SalesOrderLine, {"sales_order_id": sales_order_id, "line_no": line_no})
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "销售订单明细不存在"})
    ensure_enterprise_access(user, record.enterprise_id)
    changes = event.payload.model_dump(exclude_unset=True)
    ensure_required_changes(changes, ("enterprise_id", "ordered_at", "product_id", "product_name", "quantity", "unit", "currency", "status"))
    target_enterprise_id = changes.get("enterprise_id", record.enterprise_id)
    ensure_enterprise_access(user, target_enterprise_id)
    ensure_version(record, event.object_version)
    for key, value in changes.items():
        setattr(record, key, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/returns", response_model=ResponseEnvelope[dict])
def list_returns(
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
        ReturnRecord,
        user,
        page,
        page_size,
        keyword,
        status,
        enterprise_id,
        start_at,
        end_at,
        keyword_fields=(ReturnRecord.return_id, ReturnRecord.sales_order_id, ReturnRecord.product_id, ReturnRecord.product_name),
        status_field=ReturnRecord.status,
        time_field=ReturnRecord.returned_at,
    )
    return response_envelope(data, trace_id=request.state.trace_id)


@router.post("/returns", response_model=ResponseEnvelope[dict], status_code=201)
def create_return(
    request: Request,
    event: EventRequest[ReturnRecordCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "return")
    ensure_enterprise_access(user, event.payload.enterprise_id)
    ensure_event_id_available(db, ReturnRecord, event.event_id)
    if db.get(ReturnRecord, event.payload.return_id) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "return_id 已存在"})
    record = ReturnRecord(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/returns/{return_id}", response_model=ResponseEnvelope[dict])
def get_return(
    request: Request,
    return_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    record = db.get(ReturnRecord, return_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "退货记录不存在"})
    ensure_enterprise_access(user, record.enterprise_id)
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/returns/{return_id}", response_model=ResponseEnvelope[dict])
def update_return(
    request: Request,
    return_id: str,
    event: EventRequest[ReturnRecordPatch],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "return")
    record = db.get(ReturnRecord, return_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "退货记录不存在"})
    ensure_enterprise_access(user, record.enterprise_id)
    changes = event.payload.model_dump(exclude_unset=True)
    ensure_required_changes(changes, ("sales_order_id", "enterprise_id", "product_id", "product_name", "quantity", "unit", "reason", "currency", "returned_at", "status"))
    target_enterprise_id = changes.get("enterprise_id", record.enterprise_id)
    ensure_enterprise_access(user, target_enterprise_id)
    ensure_version(record, event.object_version)
    for key, value in changes.items():
        setattr(record, key, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)
