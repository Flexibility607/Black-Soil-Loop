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
from app.models.transport import FreezerRecord, TransportResource, TransportTaskSummary
from app.models.user import User
from app.schemas.common import EventRequest, ResponseEnvelope, response_envelope
from app.schemas.transport import (
    FreezerRecordCreate,
    FreezerRecordPatch,
    TransportResourceCreate,
    TransportResourcePatch,
    TransportTaskSummaryCreate,
    TransportTaskSummaryPatch,
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
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "只有园区管理员可以维护运输资源"})


def ensure_freezer_access(user: User, enterprise_id: str | None) -> None:
    if enterprise_id is None:
        if user.role != "park_admin":
            raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "企业管理员不能访问园区汇总冻库记录"})
        return
    ensure_enterprise_access(user, enterprise_id)


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
    elif user.role == "enterprise_admin":
        if enterprise_id is not None:
            ensure_enterprise_access(user, enterprise_id)
    if enterprise_id is not None and scope_field is not None:
        statement = select(model).where(scope_field == enterprise_id)
    else:
        statement = select(model)
    if user.role == "enterprise_admin" and scope_field is not None:
        statement = statement.where(scope_field.in_(user.enterprise_ids or []))
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


@router.get("/transport-task-summaries", response_model=ResponseEnvelope[dict])
def list_transport_tasks(
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
        TransportTaskSummary,
        user,
        page,
        page_size,
        keyword,
        status,
        enterprise_id,
        start_at,
        end_at,
        scope_field=TransportTaskSummary.enterprise_id,
        keyword_fields=(TransportTaskSummary.task_id, TransportTaskSummary.order_id, TransportTaskSummary.origin, TransportTaskSummary.destination),
        status_field=TransportTaskSummary.status,
        time_field=TransportTaskSummary.planned_depart_at,
    )
    return response_envelope(data, trace_id=request.state.trace_id)


@router.post("/transport-task-summaries", response_model=ResponseEnvelope[dict], status_code=201)
def create_transport_task(
    request: Request,
    event: EventRequest[TransportTaskSummaryCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "transport_task")
    ensure_enterprise_access(user, event.payload.enterprise_id)
    ensure_event_id_available(db, TransportTaskSummary, event.event_id)
    if db.get(TransportTaskSummary, event.payload.task_id) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "task_id 已存在"})
    record = TransportTaskSummary(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/transport-task-summaries/{task_id}", response_model=ResponseEnvelope[dict])
def get_transport_task(
    request: Request,
    task_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    record = db.get(TransportTaskSummary, task_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "运输任务摘要不存在"})
    ensure_enterprise_access(user, record.enterprise_id)
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/transport-task-summaries/{task_id}", response_model=ResponseEnvelope[dict])
def update_transport_task(
    request: Request,
    task_id: str,
    event: EventRequest[TransportTaskSummaryPatch],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "transport_task")
    record = db.get(TransportTaskSummary, task_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "运输任务摘要不存在"})
    ensure_enterprise_access(user, record.enterprise_id)
    changes = event.payload.model_dump(exclude_unset=True)
    ensure_patch(changes, ("order_id", "enterprise_id", "status", "status_version", "origin", "destination"))
    target_enterprise_id = changes.get("enterprise_id", record.enterprise_id)
    ensure_enterprise_access(user, target_enterprise_id)
    ensure_version(record, event.object_version)
    next_status_version = changes.pop("status_version", None)
    if next_status_version is not None and next_status_version <= record.status_version:
        raise HTTPException(status_code=409, detail={"code": "VERSION_CONFLICT", "message": "status_version 必须递增"})
    for key, value in changes.items():
        setattr(record, key, value)
    if next_status_version is not None:
        record.status_version = next_status_version
    elif "status" in changes:
        record.status_version += 1
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/transport-resources", response_model=ResponseEnvelope[dict])
def list_transport_resources(
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
    del enterprise_id, start_at, end_at
    data = list_records(
        db,
        TransportResource,
        user,
        page,
        page_size,
        keyword,
        status,
        None,
        None,
        None,
        scope_field=None,
        keyword_fields=(TransportResource.driver_id, TransportResource.driver_name, TransportResource.vehicle_id, TransportResource.plate_no),
        status_field=TransportResource.status,
        time_field=TransportResource.source_updated_at,
    )
    return response_envelope(data, trace_id=request.state.trace_id)


@router.post("/transport-resources", response_model=ResponseEnvelope[dict], status_code=201)
def create_transport_resource(
    request: Request,
    event: EventRequest[TransportResourceCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_park_admin(user)
    ensure_event(event, "transport_resource")
    ensure_event_id_available(db, TransportResource, event.event_id)
    key = {"driver_id": event.payload.driver_id, "vehicle_id": event.payload.vehicle_id}
    if db.get(TransportResource, key) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "运输资源业务键已存在"})
    record = TransportResource(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/transport-resources/{driver_id}/{vehicle_id}", response_model=ResponseEnvelope[dict])
def get_transport_resource(
    request: Request,
    driver_id: str,
    vehicle_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_park_admin(user)
    record = db.get(TransportResource, {"driver_id": driver_id, "vehicle_id": vehicle_id})
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "运输资源不存在"})
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/transport-resources/{driver_id}/{vehicle_id}", response_model=ResponseEnvelope[dict])
def update_transport_resource(
    request: Request,
    driver_id: str,
    vehicle_id: str,
    event: EventRequest[TransportResourcePatch],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_park_admin(user)
    ensure_event(event, "transport_resource")
    record = db.get(TransportResource, {"driver_id": driver_id, "vehicle_id": vehicle_id})
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "运输资源不存在"})
    changes = event.payload.model_dump(exclude_unset=True)
    ensure_patch(changes, ("driver_name", "on_duty", "status"))
    ensure_version(record, event.object_version)
    for key, value in changes.items():
        setattr(record, key, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/freezer-records", response_model=ResponseEnvelope[dict])
def list_freezer_records(
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
        FreezerRecord,
        user,
        page,
        page_size,
        keyword,
        status,
        enterprise_id,
        start_at,
        end_at,
        scope_field=FreezerRecord.enterprise_id,
        keyword_fields=(FreezerRecord.freezer_id, FreezerRecord.park_id),
        status_field=FreezerRecord.status,
        time_field=FreezerRecord.recorded_at,
    )
    return response_envelope(data, trace_id=request.state.trace_id)


@router.post("/freezer-records", response_model=ResponseEnvelope[dict], status_code=201)
def create_freezer_record(
    request: Request,
    event: EventRequest[FreezerRecordCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "freezer_record")
    ensure_freezer_access(user, event.payload.enterprise_id)
    ensure_event_id_available(db, FreezerRecord, event.event_id)
    key = {"freezer_id": event.payload.freezer_id, "recorded_at": event.payload.recorded_at}
    if db.scalar(select(FreezerRecord).where(FreezerRecord.freezer_id == key["freezer_id"], FreezerRecord.recorded_at == key["recorded_at"])) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "冻库记录业务键已存在"})
    record = FreezerRecord(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/freezer-records/{freezer_id}/{recorded_at}", response_model=ResponseEnvelope[dict])
def get_freezer_record(
    request: Request,
    freezer_id: str,
    recorded_at: datetime,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    record = db.scalar(select(FreezerRecord).where(FreezerRecord.freezer_id == freezer_id, FreezerRecord.recorded_at == recorded_at))
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "冻库记录不存在"})
    ensure_freezer_access(user, record.enterprise_id)
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/freezer-records/{freezer_id}/{recorded_at}", response_model=ResponseEnvelope[dict])
def update_freezer_record(
    request: Request,
    freezer_id: str,
    recorded_at: datetime,
    event: EventRequest[FreezerRecordPatch],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "freezer_record")
    record = db.scalar(select(FreezerRecord).where(FreezerRecord.freezer_id == freezer_id, FreezerRecord.recorded_at == recorded_at))
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "冻库记录不存在"})
    ensure_freezer_access(user, record.enterprise_id)
    changes = event.payload.model_dump(exclude_unset=True)
    ensure_patch(changes, ("park_id", "recorded_at", "frozen_goods_kg", "used_volume_m3", "total_volume_m3", "status"))
    target_enterprise_id = changes.get("enterprise_id", record.enterprise_id)
    ensure_freezer_access(user, target_enterprise_id)
    ensure_version(record, event.object_version)
    for key, value in changes.items():
        setattr(record, key, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)
