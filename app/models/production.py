from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.master_data import SourceTrackedMixin


class ProductionPlan(SourceTrackedMixin, Base):
    __tablename__ = "production_plans"

    plan_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    enterprise_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    product_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    specification: Mapped[str | None] = mapped_column(String(255), nullable=True)
    planned_quantity: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False)
    unit: Mapped[str] = mapped_column(String(64), nullable=False)
    qualified_quantity: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    planned_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    planned_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    workshop: Mapped[str | None] = mapped_column(String(255), nullable=True)
    owner: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)


class ProductionOrder(SourceTrackedMixin, Base):
    __tablename__ = "production_orders"

    production_order_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    plan_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    enterprise_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    product_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False)
    unit: Mapped[str] = mapped_column(String(64), nullable=False)
    priority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    process_requirement: Mapped[str | None] = mapped_column(Text, nullable=True)
    quality_requirement: Mapped[str | None] = mapped_column(Text, nullable=True)
    actual_qty: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    ordered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)


class Bom(SourceTrackedMixin, Base):
    __tablename__ = "boms"

    bom_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    enterprise_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    product_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    material_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    material_name: Mapped[str] = mapped_column(String(255), nullable=False)
    unit_usage_kg: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False)
    unit_usage_unit: Mapped[str] = mapped_column(String(64), nullable=False)
    effective_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
