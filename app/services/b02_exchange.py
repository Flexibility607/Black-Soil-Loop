import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.dashboard import B02InboxEvent, B02ServiceNonce, StoreOperationSummary
from app.models.master_data import Partner, Store
from app.schemas.dashboard import B02OutboxEvent, StoreOperationSummaryPayload


def service_signature(method: str, path: str, timestamp: str, nonce: str, body: bytes, secret: str) -> str:
    body_digest = hashlib.sha256(body).hexdigest()
    canonical = f"{method.upper()}\n{path}\n{timestamp}\n{nonce}\n{body_digest}".encode()
    return hmac.new(secret.encode(), canonical, hashlib.sha256).hexdigest()


def authenticate_b02_request(
    db: Session,
    settings: Settings,
    *,
    method: str,
    path: str,
    body: bytes,
    service_id: str | None,
    timestamp: str | None,
    nonce: str | None,
    signature: str | None,
) -> None:
    if service_id != "B02" or timestamp is None or nonce is None or signature is None:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHENTICATED", "message": "服务签名信息不完整"})
    try:
        request_seconds = int(timestamp)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHENTICATED", "message": "服务时间戳无效"}) from exc
    now = datetime.now(timezone.utc)
    if abs(int(now.timestamp()) - request_seconds) > settings.service_signature_tolerance_seconds:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHENTICATED", "message": "服务签名已过期"})
    expected = service_signature(method, path, timestamp, nonce, body, settings.b02_to_b01_shared_secret)
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHENTICATED", "message": "服务签名无效"})

    cutoff = now - timedelta(seconds=settings.service_signature_tolerance_seconds * 2)
    db.execute(delete(B02ServiceNonce).where(B02ServiceNonce.created_at < cutoff))
    db.add(B02ServiceNonce(service_id=service_id, nonce=nonce, created_at=now))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "服务 nonce 已使用"}) from exc


def _reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"JSON 字段重复: {key}")
        result[key] = value
    return result


def parse_b02_event(body: bytes) -> B02OutboxEvent:
    try:
        raw = json.loads(
            body,
            object_pairs_hook=_reject_duplicate_pairs,
            parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"非法数字: {value}")),
        )
        return B02OutboxEvent.model_validate(raw)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError, ValidationError) as exc:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": f"B02 事件校验失败: {exc}"}) from exc


def _validate_store_scope(db: Session, payload: StoreOperationSummaryPayload) -> Store:
    store = db.get(Store, payload.store_id)
    if store is None:
        raise HTTPException(status_code=422, detail={"code": "UPSTREAM_ERROR", "message": "门店主档无法关联"})
    partner = db.get(Partner, payload.partner_id)
    if partner is None or store.partner_id != payload.partner_id:
        raise HTTPException(status_code=422, detail={"code": "UPSTREAM_ERROR", "message": "合作方与门店归属不一致"})
    if partner.relationship_status != "ACTIVE" or store.relationship_status != "ACTIVE":
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "合作方或门店已停用"})
    if not store.reporting_authorized:
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "门店经营上报授权未启用"})
    if not store.park_id or not store.channel_type:
        raise HTTPException(status_code=422, detail={"code": "UPSTREAM_ERROR", "message": "门店缺少园区或渠道分类"})
    return store


def _check_version(db: Session, event: B02OutboxEvent) -> None:
    current = db.scalar(
        select(B02InboxEvent)
        .where(B02InboxEvent.object_type == event.object_type, B02InboxEvent.object_id == event.object_id)
        .order_by(B02InboxEvent.object_version.desc())
        .limit(1)
    )
    if current is None:
        if event.object_version != 1:
            raise HTTPException(status_code=409, detail={"code": "VERSION_GAP", "message": "对象首个版本必须为 1"})
        return
    if event.object_version <= current.object_version:
        raise HTTPException(status_code=409, detail={"code": "VERSION_CONFLICT", "message": "对象版本已处理"})
    if event.object_version != current.object_version + 1:
        raise HTTPException(status_code=409, detail={"code": "VERSION_GAP", "message": "对象版本存在缺口"})


def _project_store_operation(db: Session, event: B02OutboxEvent, payload: StoreOperationSummaryPayload, received_at: datetime) -> None:
    _validate_store_scope(db, payload)
    record = db.get(StoreOperationSummary, event.object_id)
    values = {
        "event_id": event.event_id,
        "partner_id": payload.partner_id,
        "store_id": payload.store_id,
        "period_start": payload.period_start,
        "period_end": payload.period_end,
        "report_status": payload.report_status,
        "sales_amount": payload.sales_amount,
        "currency": payload.currency,
        "order_count": payload.order_count,
        "average_order_amount": payload.average_order_amount,
        "quantity": payload.quantity,
        "unit": payload.unit,
        "loss_quantity": payload.loss_quantity,
        "closing_inventory": payload.closing_inventory,
        "submitted_count": payload.submitted_count,
        "missing_items": payload.missing_items,
        "report_version": payload.report_version,
        "store_operation_version": payload.store_operation_version,
        "source_updated_at": payload.updated_at,
        "received_at": received_at,
    }
    if record is None:
        db.add(StoreOperationSummary(object_id=event.object_id, **values))
        return
    for key, value in values.items():
        setattr(record, key, value)


def process_b02_event(db: Session, event: B02OutboxEvent, body: bytes) -> tuple[str, dict[str, Any]]:
    body_sha256 = hashlib.sha256(body).hexdigest()
    existing = db.get(B02InboxEvent, event.event_id)
    if existing is not None:
        if existing.body_sha256 != body_sha256:
            raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "相同 event_id 的正文不一致"})
        return existing.result_code, existing.result_json

    _check_version(db, event)
    now = datetime.now(timezone.utc)
    if isinstance(event.payload, StoreOperationSummaryPayload):
        _project_store_operation(db, event, event.payload, now)
        result = {"event_id": event.event_id, "object_version": event.object_version, "projection": "store_operation_summary"}
    else:
        result = {"event_id": event.event_id, "object_version": event.object_version, "projection": "inbox_only"}

    db.add(
        B02InboxEvent(
            event_id=event.event_id,
            trace_id=event.trace_id,
            body_sha256=body_sha256,
            object_type=event.object_type,
            object_id=event.object_id,
            object_version=event.object_version,
            occurred_at=event.occurred_at,
            payload_json=event.payload.model_dump(mode="json"),
            result_code="OK",
            result_json=result,
            processed_at=now,
        )
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail={"code": "VERSION_CONFLICT", "message": "对象版本已由并发请求处理"}) from exc
    return "OK", result
