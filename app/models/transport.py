from datetime import datetime

from sqlalchemy import DateTime, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.master_data import SourceTrackedMixin


class TransportTaskSummary(SourceTrackedMixin, Base):
    __tablename__ = "transport_task_summaries"

    task_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    order_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    enterprise_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    partner_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    store_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    status_version: Mapped[int] = mapped_column(Integer, nullable=False)
    planned_depart_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    planned_arrive_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    origin: Mapped[str] = mapped_column(String(500), nullable=False)
    destination: Mapped[str] = mapped_column(String(500), nullable=False)
    vehicle_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    driver_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    vehicle_type_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    vehicle_type_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    required_vehicle_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimated_fee: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)


class TransportResource(SourceTrackedMixin, Base):
    __tablename__ = "transport_resources"

    driver_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    driver_name: Mapped[str] = mapped_column(String(128), nullable=False)
    driver_phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    vehicle_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    vehicle_type_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    vehicle_type_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    plate_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mass_capacity_kg: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    volume_capacity_m3: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    temperature_min_celsius: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    temperature_max_celsius: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    humidity_min_percent: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    humidity_max_percent: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    on_duty: Mapped[bool] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)


class FreezerRecord(SourceTrackedMixin, Base):
    __tablename__ = "freezer_records"

    freezer_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    park_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    enterprise_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    frozen_goods_kg: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False)
    used_volume_m3: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False)
    total_volume_m3: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
