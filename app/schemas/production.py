from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field

from app.schemas.master_data import PatchModel


class ProductionPlanCreate(PatchModel):
    plan_id: str = Field(min_length=1, max_length=64)
    enterprise_id: str = Field(min_length=1, max_length=64)
    product_id: str = Field(min_length=1, max_length=64)
    product_name: str = Field(min_length=1, max_length=255)
    specification: str | None = Field(default=None, max_length=255)
    planned_quantity: Decimal = Field(gt=0)
    unit: str = Field(min_length=1, max_length=64)
    qualified_quantity: Decimal | None = Field(default=None, ge=0)
    planned_start_at: datetime | None = None
    planned_end_at: datetime | None = None
    actual_start_at: datetime | None = None
    actual_end_at: datetime | None = None
    workshop: str | None = Field(default=None, max_length=255)
    owner: str | None = Field(default=None, max_length=128)
    status: Literal["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]
    remark: str | None = None


class ProductionPlanPatch(PatchModel):
    enterprise_id: str | None = Field(default=None, min_length=1, max_length=64)
    product_id: str | None = Field(default=None, min_length=1, max_length=64)
    product_name: str | None = Field(default=None, min_length=1, max_length=255)
    specification: str | None = Field(default=None, max_length=255)
    planned_quantity: Decimal | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, min_length=1, max_length=64)
    qualified_quantity: Decimal | None = Field(default=None, ge=0)
    planned_start_at: datetime | None = None
    planned_end_at: datetime | None = None
    actual_start_at: datetime | None = None
    actual_end_at: datetime | None = None
    workshop: str | None = Field(default=None, max_length=255)
    owner: str | None = Field(default=None, max_length=128)
    status: Literal["NOT_STARTED", "IN_PROGRESS", "COMPLETED"] | None = None
    remark: str | None = None


class ProductionOrderCreate(PatchModel):
    production_order_id: str = Field(min_length=1, max_length=64)
    plan_id: str | None = Field(default=None, max_length=64)
    enterprise_id: str = Field(min_length=1, max_length=64)
    product_id: str = Field(min_length=1, max_length=64)
    product_name: str = Field(min_length=1, max_length=255)
    quantity: Decimal = Field(gt=0)
    unit: str = Field(min_length=1, max_length=64)
    priority: int | None = Field(default=None, ge=0)
    process_requirement: str | None = None
    quality_requirement: str | None = None
    actual_qty: Decimal | None = Field(default=None, ge=0)
    ordered_at: datetime | None = None
    status: Literal["DRAFT", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]
    remark: str | None = None


class ProductionOrderPatch(PatchModel):
    plan_id: str | None = Field(default=None, max_length=64)
    enterprise_id: str | None = Field(default=None, min_length=1, max_length=64)
    product_id: str | None = Field(default=None, min_length=1, max_length=64)
    product_name: str | None = Field(default=None, min_length=1, max_length=255)
    quantity: Decimal | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, min_length=1, max_length=64)
    priority: int | None = Field(default=None, ge=0)
    process_requirement: str | None = None
    quality_requirement: str | None = None
    actual_qty: Decimal | None = Field(default=None, ge=0)
    ordered_at: datetime | None = None
    status: Literal["DRAFT", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] | None = None
    remark: str | None = None


class BomCreate(PatchModel):
    bom_id: str = Field(min_length=1, max_length=64)
    enterprise_id: str | None = Field(default=None, max_length=64)
    product_id: str = Field(min_length=1, max_length=64)
    product_name: str = Field(min_length=1, max_length=255)
    material_id: str = Field(min_length=1, max_length=64)
    material_name: str = Field(min_length=1, max_length=255)
    unit_usage_kg: Decimal = Field(gt=0)
    unit_usage_unit: str = Field(min_length=1, max_length=64)
    effective_from: date | None = None
    effective_to: date | None = None
    status: Literal["ACTIVE", "INACTIVE"]
    remark: str | None = None


class BomPatch(PatchModel):
    enterprise_id: str | None = Field(default=None, max_length=64)
    product_name: str | None = Field(default=None, min_length=1, max_length=255)
    material_name: str | None = Field(default=None, min_length=1, max_length=255)
    unit_usage_kg: Decimal | None = Field(default=None, gt=0)
    unit_usage_unit: str | None = Field(default=None, min_length=1, max_length=64)
    effective_from: date | None = None
    effective_to: date | None = None
    status: Literal["ACTIVE", "INACTIVE"] | None = None
    remark: str | None = None
