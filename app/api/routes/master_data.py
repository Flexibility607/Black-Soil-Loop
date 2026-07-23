from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, inspect, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.master_data import Enterprise, EnterpriseTag, Park, Partner, Store
from app.models.user import User
from app.schemas.common import EventRequest, ResponseEnvelope, response_envelope
from app.schemas.master_data import (
    EnterpriseCreate,
    EnterprisePatch,
    EnterpriseTagCreate,
    EnterpriseTagPatch,
    ParkCreate,
    ParkPatch,
    PartnerCreate,
    PartnerPatch,
    StoreCreate,
    StorePatch,
)

router = APIRouter(tags=["E01 Resources"])


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def record_data(record: Any) -> dict[str, Any]:
    return {
        column.key: float(value) if isinstance(value := getattr(record, column.key), Decimal) else value
        for column in inspect(record).mapper.column_attrs
    }


def list_data(items: list[Any], total: int, page: int, page_size: int) -> dict[str, Any]:
    return {"items": [record_data(item) for item in items], "total": total, "page": page, "page_size": page_size}


def list_records(
    db: Session,
    model: type,
    user: User,
    page: int,
    page_size: int,
    keyword: str | None,
    status: str | None,
    *,
    scope_field=None,
    keyword_fields: tuple[Any, ...] = (),
    status_field=None,
) -> dict[str, Any]:
    statement = select(model)
    if user.role == "enterprise_admin" and scope_field is not None:
        statement = statement.where(scope_field.in_(user.enterprise_ids or []))
    if keyword and keyword_fields:
        statement = statement.where(or_(*(field.ilike(f"%{keyword}%") for field in keyword_fields)))
    if status and status_field is not None:
        statement = statement.where(status_field == status)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    items = db.scalars(statement.offset((page - 1) * page_size).limit(page_size)).all()
    return list_data(items, total, page, page_size)


def ensure_event(event: EventRequest, object_type: str) -> None:
    if event.object_type != object_type:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": f"object_type 必须为 {object_type}"})


def ensure_event_id_available(db: Session, model: type, event_id: str) -> None:
    existing = db.scalar(select(model).where(model.source_system == "WEB_API", model.source_record_id == event_id))
    if existing is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "event_id 已处理，请勿重复提交"})


def ensure_park_admin(user: User) -> None:
    if user.role != "park_admin":
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "只有园区管理员可以执行此操作"})


def ensure_enterprise_access(user: User, enterprise_id: str, *, allow_park_admin: bool = True) -> None:
    if user.role == "park_admin" and allow_park_admin:
        return
    if user.role != "enterprise_admin" or enterprise_id not in (user.enterprise_ids or []):
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "超出当前企业授权范围"})


def ensure_version(record: Any, object_version: int) -> None:
    if record.object_version != object_version:
        raise HTTPException(status_code=409, detail={"code": "VERSION_CONFLICT", "message": "对象版本已变化，请重新获取后再修改"})


def write_metadata(record: Any, event_id: str) -> None:
    record.source_system = "WEB_API"
    record.source_record_id = event_id
    record.source_updated_at = now_utc()


@router.get("/parks", response_model=ResponseEnvelope[dict])
def list_parks(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    status: str | None = None,
) -> dict:
    return response_envelope(list_records(db, Park, user, page, page_size, keyword, status, keyword_fields=(Park.park_id, Park.park_name), status_field=Park.status), trace_id=request.state.trace_id)


@router.post("/parks", response_model=ResponseEnvelope[dict], status_code=201)
def create_park(request: Request, event: EventRequest[ParkCreate], db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    ensure_park_admin(user)
    ensure_event(event, "park")
    ensure_event_id_available(db, Park, event.event_id)
    if db.get(Park, event.payload.park_id) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "park_id 已存在"})
    record = Park(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/parks/{park_id}", response_model=ResponseEnvelope[dict])
def get_park(request: Request, park_id: str, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    record = db.get(Park, park_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "园区不存在"})
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/parks/{park_id}", response_model=ResponseEnvelope[dict])
def update_park(request: Request, park_id: str, event: EventRequest[ParkPatch], db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    ensure_park_admin(user)
    ensure_event(event, "park")
    record = db.get(Park, park_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "园区不存在"})
    ensure_version(record, event.object_version)
    changes = event.payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "PATCH 至少需要一个字段"})
    for key, value in changes.items():
        setattr(record, key, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/enterprises", response_model=ResponseEnvelope[dict])
def list_enterprises(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    status: str | None = None,
) -> dict:
    return response_envelope(list_records(db, Enterprise, user, page, page_size, keyword, status, scope_field=Enterprise.enterprise_id, keyword_fields=(Enterprise.enterprise_id, Enterprise.enterprise_name), status_field=Enterprise.status), trace_id=request.state.trace_id)


@router.post("/enterprises", response_model=ResponseEnvelope[dict], status_code=201)
def create_enterprise(request: Request, event: EventRequest[EnterpriseCreate], db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    ensure_park_admin(user)
    ensure_event(event, "enterprise")
    ensure_event_id_available(db, Enterprise, event.event_id)
    if db.get(Enterprise, event.payload.enterprise_id) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "enterprise_id 已存在"})
    record = Enterprise(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/enterprises/{enterprise_id}", response_model=ResponseEnvelope[dict])
def get_enterprise(request: Request, enterprise_id: str, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    ensure_enterprise_access(user, enterprise_id)
    record = db.get(Enterprise, enterprise_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "企业不存在"})
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/enterprises/{enterprise_id}", response_model=ResponseEnvelope[dict])
def update_enterprise(request: Request, enterprise_id: str, event: EventRequest[EnterprisePatch], db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    ensure_event(event, "enterprise")
    ensure_enterprise_access(user, enterprise_id)
    record = db.get(Enterprise, enterprise_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "企业不存在"})
    ensure_version(record, event.object_version)
    changes = event.payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "PATCH 至少需要一个字段"})
    for key, value in changes.items():
        setattr(record, key, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/enterprise-tags", response_model=ResponseEnvelope[dict])
def list_enterprise_tags(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
) -> dict:
    return response_envelope(list_records(db, EnterpriseTag, user, page, page_size, keyword, None, scope_field=EnterpriseTag.enterprise_id, keyword_fields=(EnterpriseTag.enterprise_id, EnterpriseTag.tag)), trace_id=request.state.trace_id)


@router.post("/enterprise-tags", response_model=ResponseEnvelope[dict], status_code=201)
def create_enterprise_tag(request: Request, event: EventRequest[EnterpriseTagCreate], db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    ensure_event(event, "enterprise_tag")
    ensure_enterprise_access(user, event.payload.enterprise_id)
    ensure_event_id_available(db, EnterpriseTag, event.event_id)
    key = {"enterprise_id": event.payload.enterprise_id, "tag": event.payload.tag}
    if db.get(EnterpriseTag, key) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "企业标签已存在"})
    record = EnterpriseTag(**key, remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/enterprise-tags/{enterprise_id}/{tag}", response_model=ResponseEnvelope[dict])
def get_enterprise_tag(request: Request, enterprise_id: str, tag: str, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    ensure_enterprise_access(user, enterprise_id)
    record = db.get(EnterpriseTag, {"enterprise_id": enterprise_id, "tag": tag})
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "企业标签不存在"})
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/enterprise-tags/{enterprise_id}/{tag}", response_model=ResponseEnvelope[dict])
def update_enterprise_tag(request: Request, enterprise_id: str, tag: str, event: EventRequest[EnterpriseTagPatch], db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    ensure_event(event, "enterprise_tag")
    ensure_enterprise_access(user, enterprise_id)
    record = db.get(EnterpriseTag, {"enterprise_id": enterprise_id, "tag": tag})
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "企业标签不存在"})
    ensure_version(record, event.object_version)
    changes = event.payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "PATCH 至少需要一个字段"})
    for key, value in changes.items():
        setattr(record, key, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/partners", response_model=ResponseEnvelope[dict])
def list_partners(request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)], page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), keyword: str | None = None, status: str | None = None) -> dict:
    return response_envelope(list_records(db, Partner, user, page, page_size, keyword, status, keyword_fields=(Partner.partner_id, Partner.partner_name), status_field=Partner.relationship_status), trace_id=request.state.trace_id)


@router.post("/partners", response_model=ResponseEnvelope[dict], status_code=201)
def create_partner(request: Request, event: EventRequest[PartnerCreate], db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    ensure_park_admin(user)
    ensure_event(event, "partner")
    ensure_event_id_available(db, Partner, event.event_id)
    if db.get(Partner, event.payload.partner_id) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "partner_id 已存在"})
    record = Partner(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/partners/{partner_id}", response_model=ResponseEnvelope[dict])
def get_partner(request: Request, partner_id: str, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    record = db.get(Partner, partner_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "合作方不存在"})
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/partners/{partner_id}", response_model=ResponseEnvelope[dict])
def update_partner(request: Request, partner_id: str, event: EventRequest[PartnerPatch], db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    ensure_park_admin(user)
    ensure_event(event, "partner")
    record = db.get(Partner, partner_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "合作方不存在"})
    ensure_version(record, event.object_version)
    changes = event.payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "PATCH 至少需要一个字段"})
    for key, value in changes.items():
        setattr(record, key, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/stores", response_model=ResponseEnvelope[dict])
def list_stores(request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)], page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), keyword: str | None = None, status: str | None = None) -> dict:
    return response_envelope(list_records(db, Store, user, page, page_size, keyword, status, keyword_fields=(Store.store_id, Store.store_name), status_field=Store.relationship_status), trace_id=request.state.trace_id)


@router.post("/stores", response_model=ResponseEnvelope[dict], status_code=201)
def create_store(request: Request, event: EventRequest[StoreCreate], db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    ensure_park_admin(user)
    ensure_event(event, "store")
    ensure_event_id_available(db, Store, event.event_id)
    if db.get(Store, event.payload.store_id) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "store_id 已存在"})
    record = Store(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/stores/{store_id}", response_model=ResponseEnvelope[dict])
def get_store(request: Request, store_id: str, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    record = db.get(Store, store_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "门店不存在"})
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/stores/{store_id}", response_model=ResponseEnvelope[dict])
def update_store(request: Request, store_id: str, event: EventRequest[StorePatch], db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]) -> dict:
    ensure_park_admin(user)
    ensure_event(event, "store")
    record = db.get(Store, store_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "门店不存在"})
    ensure_version(record, event.object_version)
    changes = event.payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "PATCH 至少需要一个字段"})
    for key, value in changes.items():
        setattr(record, key, value)
    record.object_version += 1
    write_metadata(record, event.event_id)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)
