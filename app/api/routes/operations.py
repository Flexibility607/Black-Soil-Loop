from datetime import datetime, timezone
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes.master_data import ensure_enterprise_access, ensure_event, ensure_event_id_available, ensure_version, record_data, write_metadata
from app.db.session import get_db
from app.models.business_records import Inventory
from app.models.operations import CalculationRun, EnterpriseCapacity, InventoryAlert, InventoryThresholdRequest, ProcurementHistory, TransportTelemetry
from app.models.transport import TransportResource, TransportTaskSummary
from app.models.user import User
from app.schemas.common import EventRequest, ResponseEnvelope, response_envelope
from app.schemas.operations import (
    ApprovalDecision,
    EnterpriseCapacityCreate,
    EnterpriseCapacityPatch,
    InventoryThresholdRequestCreate,
    ProcurementHistoryCreate,
    ProcurementHistoryPatch,
    TransportTelemetryCreate,
)

router = APIRouter(tags=["E01 Operations"])


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def ensure_park_admin(user: User) -> None:
    if user.role != "park_admin":
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "只有园区管理员可以执行此操作"})


def ensure_enterprise_or_park(user: User, enterprise_id: str) -> None:
    ensure_enterprise_access(user, enterprise_id)


def paged(items: list[Any], page: int, page_size: int) -> dict[str, Any]:
    start = (page - 1) * page_size
    return {"items": items[start : start + page_size], "total": len(items), "page": page, "page_size": page_size}


def sync_inventory_alert(db: Session, threshold: InventoryThresholdRequest) -> InventoryAlert | None:
    inventory = db.get(Inventory, threshold.inventory_record_id)
    if inventory is None:
        return None
    if threshold.safety_stock_qty is not None:
        threshold_qty = float(threshold.safety_stock_qty)
    elif threshold.target_stock_qty is not None and threshold.safety_stock_ratio is not None:
        threshold_qty = float(threshold.target_stock_qty) * float(threshold.safety_stock_ratio)
    else:
        return None
    current_qty = float(inventory.current_qty)
    active_alert = db.scalar(
        select(InventoryAlert)
        .where(InventoryAlert.inventory_record_id == inventory.inventory_record_id, InventoryAlert.status.in_(["OPEN", "ACKNOWLEDGED"]))
        .order_by(InventoryAlert.detected_at.desc())
    )
    if current_qty <= threshold_qty:
        if active_alert is None:
            active_alert = InventoryAlert(
                alert_id=f"ALERT-{uuid4().hex[:16].upper()}",
                inventory_record_id=inventory.inventory_record_id,
                enterprise_id=inventory.enterprise_id,
                product_id=inventory.product_id,
                warehouse_id=inventory.warehouse_id,
                current_qty=current_qty,
                threshold_qty=threshold_qty,
                status="OPEN",
                detected_at=now_utc(),
            )
            db.add(active_alert)
        else:
            active_alert.current_qty = current_qty
            active_alert.threshold_qty = threshold_qty
        return active_alert
    if active_alert is not None:
        active_alert.status = "RESOLVED"
        active_alert.resolved_at = now_utc()
    return None


@router.get("/enterprise-capacities", response_model=ResponseEnvelope[dict])
def list_capacities(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    enterprise_id: str | None = None,
    product_category_id: str | None = None,
    status: str | None = None,
) -> dict:
    if enterprise_id is not None:
        ensure_enterprise_access(user, enterprise_id)
    statement = select(EnterpriseCapacity)
    if user.role == "enterprise_admin":
        statement = statement.where(EnterpriseCapacity.enterprise_id.in_(user.enterprise_ids or []))
    if enterprise_id is not None:
        statement = statement.where(EnterpriseCapacity.enterprise_id == enterprise_id)
    if product_category_id is not None:
        statement = statement.where(EnterpriseCapacity.product_category_id == product_category_id)
    if status is not None:
        statement = statement.where(EnterpriseCapacity.status == status)
    items = db.scalars(statement.order_by(EnterpriseCapacity.effective_from.desc())).all()
    return response_envelope(paged([record_data(item) for item in items], page, page_size), trace_id=request.state.trace_id)


@router.post("/enterprise-capacities", response_model=ResponseEnvelope[dict], status_code=201)
def create_capacity(
    request: Request,
    event: EventRequest[EnterpriseCapacityCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "enterprise_capacity")
    ensure_enterprise_or_park(user, event.payload.enterprise_id)
    ensure_event_id_available(db, EnterpriseCapacity, event.event_id)
    if db.get(EnterpriseCapacity, event.payload.capacity_id) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "capacity_id 已存在"})
    record = EnterpriseCapacity(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/enterprise-capacities/{capacity_id}", response_model=ResponseEnvelope[dict])
def update_capacity(
    request: Request,
    capacity_id: str,
    event: EventRequest[EnterpriseCapacityPatch],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "enterprise_capacity")
    record = db.get(EnterpriseCapacity, capacity_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "日产能记录不存在"})
    ensure_enterprise_or_park(user, record.enterprise_id)
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


@router.get("/inventory-threshold-requests", response_model=ResponseEnvelope[dict])
def list_threshold_requests(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = None,
) -> dict:
    statement = select(InventoryThresholdRequest)
    if user.role == "enterprise_admin":
        statement = statement.where(InventoryThresholdRequest.enterprise_id.in_(user.enterprise_ids or []))
    if status is not None:
        statement = statement.where(InventoryThresholdRequest.status == status)
    items = db.scalars(statement.order_by(InventoryThresholdRequest.submitted_at.desc())).all()
    return response_envelope(paged([record_data(item) for item in items], page, page_size), trace_id=request.state.trace_id)


@router.post("/inventory-threshold-requests", response_model=ResponseEnvelope[dict], status_code=201)
def create_threshold_request(
    request: Request,
    event: EventRequest[InventoryThresholdRequestCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    if user.role != "enterprise_admin":
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "安全库存只能由企业负责人提交"})
    ensure_event(event, "inventory_threshold_request")
    ensure_enterprise_access(user, event.payload.enterprise_id)
    inventory = db.get(Inventory, event.payload.inventory_record_id)
    if inventory is None or inventory.enterprise_id != event.payload.enterprise_id or inventory.product_id != event.payload.product_id or inventory.warehouse_id != event.payload.warehouse_id:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "库存记录与企业、商品或仓库不一致"})
    ensure_event_id_available(db, InventoryThresholdRequest, event.event_id)
    duplicate_pending = db.scalar(select(InventoryThresholdRequest).where(InventoryThresholdRequest.inventory_record_id == event.payload.inventory_record_id, InventoryThresholdRequest.status == "PENDING"))
    if duplicate_pending is not None:
        raise HTTPException(status_code=409, detail={"code": "STATE_CONFLICT", "message": "该库存已有待审批安全库存申请"})
    record = InventoryThresholdRequest(
        **event.payload.model_dump(exclude={"remark"}),
        status="PENDING",
        submitted_by=user.user_id,
        submitted_at=now_utc(),
        remark=event.payload.remark,
    )
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.post("/inventory-threshold-requests/{threshold_request_id}/approve", response_model=ResponseEnvelope[dict])
def approve_threshold_request(
    request: Request,
    threshold_request_id: str,
    body: ApprovalDecision,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_park_admin(user)
    record = db.get(InventoryThresholdRequest, threshold_request_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "安全库存申请不存在"})
    if record.status != "PENDING":
        raise HTTPException(status_code=409, detail={"code": "STATE_CONFLICT", "message": "只有待审批申请可以审批"})
    previous = db.scalars(select(InventoryThresholdRequest).where(InventoryThresholdRequest.inventory_record_id == record.inventory_record_id, InventoryThresholdRequest.status == "APPROVED")).all()
    for item in previous:
        item.status = "SUPERSEDED"
        item.object_version += 1
    record.status = "APPROVED"
    record.approved_by = user.user_id
    record.approved_at = now_utc()
    record.effective_at = record.approved_at
    record.approval_comment = body.comment
    record.object_version += 1
    alert = sync_inventory_alert(db, record)
    db.commit()
    result = record_data(record)
    result["current_alert"] = record_data(alert) if alert is not None else None
    return response_envelope(result, trace_id=request.state.trace_id)


@router.post("/inventory-threshold-requests/{threshold_request_id}/reject", response_model=ResponseEnvelope[dict])
def reject_threshold_request(
    request: Request,
    threshold_request_id: str,
    body: ApprovalDecision,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_park_admin(user)
    if not body.comment:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "驳回必须填写批注"})
    record = db.get(InventoryThresholdRequest, threshold_request_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "安全库存申请不存在"})
    if record.status != "PENDING":
        raise HTTPException(status_code=409, detail={"code": "STATE_CONFLICT", "message": "只有待审批申请可以驳回"})
    record.status = "REJECTED"
    record.approved_by = user.user_id
    record.approved_at = now_utc()
    record.approval_comment = body.comment
    record.object_version += 1
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/inventory-alerts", response_model=ResponseEnvelope[dict])
def list_inventory_alerts(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = Query(None),
) -> dict:
    approved = select(InventoryThresholdRequest).where(InventoryThresholdRequest.status == "APPROVED")
    if user.role == "enterprise_admin":
        approved = approved.where(InventoryThresholdRequest.enterprise_id.in_(user.enterprise_ids or []))
    for threshold in db.scalars(approved).all():
        sync_inventory_alert(db, threshold)
    db.commit()
    statement = select(InventoryAlert)
    if user.role == "enterprise_admin":
        statement = statement.where(InventoryAlert.enterprise_id.in_(user.enterprise_ids or []))
    if status is not None:
        statement = statement.where(InventoryAlert.status == status)
    items = db.scalars(statement.order_by(InventoryAlert.detected_at.desc())).all()
    return response_envelope(paged([record_data(item) for item in items], page, page_size), trace_id=request.state.trace_id)


@router.post("/inventory-alerts/{alert_id}/acknowledge", response_model=ResponseEnvelope[dict])
def acknowledge_inventory_alert(
    request: Request,
    alert_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    alert = db.get(InventoryAlert, alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "库存预警不存在"})
    ensure_enterprise_access(user, alert.enterprise_id, allow_park_admin=False)
    if alert.status != "OPEN":
        raise HTTPException(status_code=409, detail={"code": "STATE_CONFLICT", "message": "只有未确认预警可以确认"})
    alert.status = "ACKNOWLEDGED"
    alert.acknowledged_by = user.user_id
    alert.acknowledged_at = now_utc()
    db.commit()
    return response_envelope(record_data(alert), trace_id=request.state.trace_id)


@router.get("/transport-telemetry", response_model=ResponseEnvelope[dict])
def list_transport_telemetry(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    task_id: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict:
    statement = select(TransportTelemetry)
    if task_id is not None:
        statement = statement.where(TransportTelemetry.task_id == task_id)
    if user.role == "enterprise_admin":
        task_ids = select(TransportTaskSummary.task_id).where(TransportTaskSummary.enterprise_id.in_(user.enterprise_ids or []))
        statement = statement.where(TransportTelemetry.task_id.in_(task_ids))
    items = db.scalars(statement.order_by(TransportTelemetry.recorded_at.asc())).all()
    return response_envelope(paged([record_data(item) for item in items], page, page_size), trace_id=request.state.trace_id)


@router.post("/transport-telemetry", response_model=ResponseEnvelope[dict], status_code=201)
def create_transport_telemetry(
    request: Request,
    event: EventRequest[TransportTelemetryCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_park_admin(user)
    ensure_event(event, "transport_telemetry")
    task = db.get(TransportTaskSummary, event.payload.task_id)
    if task is None:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "task_id 不存在"})
    resource = db.scalar(select(TransportResource).where(TransportResource.vehicle_id == event.payload.vehicle_id))
    anomaly = event.payload.anomaly_status
    if resource is not None:
        temperature = event.payload.actual_temperature_celsius
        humidity = event.payload.actual_humidity_percent
        if temperature is not None and ((resource.temperature_min_celsius is not None and temperature < resource.temperature_min_celsius) or (resource.temperature_max_celsius is not None and temperature > resource.temperature_max_celsius)):
            anomaly = "TEMPERATURE_ABNORMAL"
        elif humidity is not None and ((resource.humidity_min_percent is not None and humidity < resource.humidity_min_percent) or (resource.humidity_max_percent is not None and humidity > resource.humidity_max_percent)):
            anomaly = "HUMIDITY_ABNORMAL"
    payload = event.payload.model_dump(exclude={"remark", "anomaly_status"})
    payload["anomaly_status"] = anomaly
    ensure_event_id_available(db, TransportTelemetry, event.event_id)
    if db.get(TransportTelemetry, event.payload.telemetry_id) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "telemetry_id 已存在"})
    record = TransportTelemetry(**payload, remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.get("/procurement-history", response_model=ResponseEnvelope[dict])
def list_procurement_history(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    material_id: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict:
    statement = select(ProcurementHistory)
    if user.role == "enterprise_admin":
        statement = statement.where(ProcurementHistory.enterprise_id.in_(user.enterprise_ids or []))
    if material_id is not None:
        statement = statement.where(ProcurementHistory.material_id == material_id)
    if start_at is not None:
        statement = statement.where(ProcurementHistory.purchased_at >= start_at)
    if end_at is not None:
        statement = statement.where(ProcurementHistory.purchased_at <= end_at)
    items = db.scalars(statement.order_by(ProcurementHistory.purchased_at.desc())).all()
    return response_envelope(paged([record_data(item) for item in items], page, page_size), trace_id=request.state.trace_id)


@router.post("/procurement-history", response_model=ResponseEnvelope[dict], status_code=201)
def create_procurement_history(
    request: Request,
    event: EventRequest[ProcurementHistoryCreate],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "procurement_history")
    ensure_enterprise_access(user, event.payload.enterprise_id)
    ensure_event_id_available(db, ProcurementHistory, event.event_id)
    if db.get(ProcurementHistory, event.payload.purchase_record_id) is not None:
        raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "purchase_record_id 已存在"})
    record = ProcurementHistory(**event.payload.model_dump(exclude={"remark"}), remark=event.payload.remark)
    write_metadata(record, event.event_id)
    db.add(record)
    db.commit()
    return response_envelope(record_data(record), trace_id=request.state.trace_id)


@router.patch("/procurement-history/{purchase_record_id}", response_model=ResponseEnvelope[dict])
def update_procurement_history(
    request: Request,
    purchase_record_id: str,
    event: EventRequest[ProcurementHistoryPatch],
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    ensure_event(event, "procurement_history")
    record = db.get(ProcurementHistory, purchase_record_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "采购历史不存在"})
    ensure_enterprise_access(user, record.enterprise_id)
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


@router.get("/calculation-runs", response_model=ResponseEnvelope[dict])
def list_calculation_runs(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    calculation_type: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> dict:
    statement = select(CalculationRun)
    if user.role == "enterprise_admin":
        statement = statement.where(CalculationRun.enterprise_id.in_(user.enterprise_ids or []))
    if calculation_type is not None:
        statement = statement.where(CalculationRun.calculation_type == calculation_type)
    items = db.scalars(statement.order_by(CalculationRun.created_at.desc())).all()
    return response_envelope(paged([record_data(item) for item in items], page, page_size), trace_id=request.state.trace_id)
