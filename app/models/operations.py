from datetime import date, datetime

from sqlalchemy import Date, DateTime, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.master_data import SourceTrackedMixin


class EnterpriseCapacity(SourceTrackedMixin, Base):
    __tablename__ = "enterprise_capacities"

    capacity_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    enterprise_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    product_category_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    product_category_name: Mapped[str] = mapped_column(String(255), nullable=False)
    daily_capacity: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False)
    unit: Mapped[str] = mapped_column(String(64), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)


class InventoryThresholdRequest(SourceTrackedMixin, Base):
    __tablename__ = "inventory_threshold_requests"

    threshold_request_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    inventory_record_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    enterprise_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    product_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    warehouse_id: Mapped[str] = mapped_column(String(64), nullable=False)
    safety_stock_qty: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    target_stock_qty: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    safety_stock_ratio: Mapped[float | None] = mapped_column(Numeric(10, 6), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    submitted_by: Mapped[str] = mapped_column(String(64), nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    approved_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    effective_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approval_comment: Mapped[str | None] = mapped_column(Text, nullable=True)


class InventoryAlert(Base):
    __tablename__ = "inventory_alerts"

    alert_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    inventory_record_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    enterprise_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    product_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    warehouse_id: Mapped[str] = mapped_column(String(64), nullable=False)
    current_qty: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False)
    threshold_qty: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    acknowledged_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)


class TransportTelemetry(SourceTrackedMixin, Base):
    __tablename__ = "transport_telemetry"

    telemetry_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    vehicle_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    actual_temperature_celsius: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    actual_humidity_percent: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    longitude: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    anomaly_status: Mapped[str] = mapped_column(String(32), nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)


class ProcurementHistory(SourceTrackedMixin, Base):
    __tablename__ = "procurement_history"

    purchase_record_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    enterprise_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    purchased_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    material_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    material_name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity_kg: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False)
    unit_price: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    supplier_id: Mapped[str] = mapped_column(String(64), nullable=False)
    supplier_name: Mapped[str] = mapped_column(String(255), nullable=False)
    supplier_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)


class CalculationRun(Base):
    __tablename__ = "calculation_runs"

    run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    calculation_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    enterprise_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    input_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    result_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    rules_version: Mapped[str] = mapped_column(String(32), nullable=False)
    calculation_status: Mapped[str] = mapped_column(String(32), nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
