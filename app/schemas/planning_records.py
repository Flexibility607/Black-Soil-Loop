from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field

from app.schemas.master_data import PatchModel


class PreorderCreate(PatchModel):
    preorder_id: str = Field(min_length=1, max_length=64)
    partner_id: str = Field(min_length=1, max_length=64)
    store_id: str = Field(min_length=1, max_length=64)
    product_id: str = Field(min_length=1, max_length=64)
    product_name: str = Field(min_length=1, max_length=255)
    quantity: Decimal = Field(gt=0)
    unit: str = Field(min_length=1, max_length=64)
    required_at: datetime
    priority: int | None = Field(default=None, ge=0)
    source_type: Literal["MANUAL", "FILE"]
    status: Literal["DRAFT", "CONFIRMED", "COMPLETED", "CANCELLED"]
    created_at: datetime
    updated_at: datetime
    remark: str | None = None


class PreorderPatch(PatchModel):
    partner_id: str | None = Field(default=None, min_length=1, max_length=64)
    store_id: str | None = Field(default=None, min_length=1, max_length=64)
    product_id: str | None = Field(default=None, min_length=1, max_length=64)
    product_name: str | None = Field(default=None, min_length=1, max_length=255)
    quantity: Decimal | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, min_length=1, max_length=64)
    required_at: datetime | None = None
    priority: int | None = Field(default=None, ge=0)
    source_type: Literal["MANUAL", "FILE"] | None = None
    status: Literal["DRAFT", "CONFIRMED", "COMPLETED", "CANCELLED"] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    remark: str | None = None


class ProcurementDemandCreate(PatchModel):
    demand_id: str = Field(min_length=1, max_length=64)
    enterprise_id: str = Field(min_length=1, max_length=64)
    material_id: str = Field(min_length=1, max_length=64)
    material_name: str = Field(min_length=1, max_length=255)
    demand_quantity: Decimal = Field(gt=0)
    unit: Literal["kg"]
    period_start: date
    period_end: date
    source_type: Literal["MANUAL", "FILE", "CALCULATED"]
    status: Literal["DRAFT", "CONFIRMED", "CANCELLED"]
    created_at: datetime
    remark: str | None = None


class ProcurementDemandPatch(PatchModel):
    enterprise_id: str | None = Field(default=None, min_length=1, max_length=64)
    material_id: str | None = Field(default=None, min_length=1, max_length=64)
    material_name: str | None = Field(default=None, min_length=1, max_length=255)
    demand_quantity: Decimal | None = Field(default=None, gt=0)
    unit: Literal["kg"] | None = None
    period_start: date | None = None
    period_end: date | None = None
    source_type: Literal["MANUAL", "FILE", "CALCULATED"] | None = None
    status: Literal["DRAFT", "CONFIRMED", "CANCELLED"] | None = None
    created_at: datetime | None = None
    remark: str | None = None


class SupplierQuoteCreate(PatchModel):
    supplier_id: str = Field(min_length=1, max_length=64)
    supplier_name: str = Field(min_length=1, max_length=255)
    material_id: str = Field(min_length=1, max_length=64)
    material_name: str = Field(min_length=1, max_length=255)
    tier_id: str = Field(min_length=1, max_length=64)
    minimum_kg: Decimal = Field(ge=0)
    capacity_kg: Decimal | None = Field(default=None, ge=0)
    unit_price: Decimal = Field(ge=0)
    currency: Literal["CNY"]
    valid_from: date | None = None
    valid_to: date | None = None
    status: Literal["ACTIVE", "INACTIVE"]
    remark: str | None = None


class SupplierQuotePatch(PatchModel):
    supplier_name: str | None = Field(default=None, min_length=1, max_length=255)
    material_name: str | None = Field(default=None, min_length=1, max_length=255)
    minimum_kg: Decimal | None = Field(default=None, ge=0)
    capacity_kg: Decimal | None = Field(default=None, ge=0)
    unit_price: Decimal | None = Field(default=None, ge=0)
    currency: Literal["CNY"] | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    status: Literal["ACTIVE", "INACTIVE"] | None = None
    remark: str | None = None


class PolicyCreate(PatchModel):
    policy_id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=255)
    category: str = Field(min_length=1, max_length=128)
    publisher: str | None = Field(default=None, max_length=255)
    region: str | None = Field(default=None, max_length=128)
    industry: str | None = Field(default=None, max_length=128)
    published_date: date | None = None
    effective_date: date | None = None
    expiration_date: date | None = None
    summary: str = Field(min_length=1)
    conditions: str | None = None
    source_url: str = Field(min_length=1, max_length=1000)
    attachment_path: str | None = Field(default=None, max_length=1000)
    status: Literal["DRAFT", "ACTIVE", "EXPIRED", "INACTIVE"]
    remark: str | None = None


class PolicyPatch(PatchModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    category: str | None = Field(default=None, min_length=1, max_length=128)
    publisher: str | None = Field(default=None, max_length=255)
    region: str | None = Field(default=None, max_length=128)
    industry: str | None = Field(default=None, max_length=128)
    published_date: date | None = None
    effective_date: date | None = None
    expiration_date: date | None = None
    summary: str | None = Field(default=None, min_length=1)
    conditions: str | None = None
    source_url: str | None = Field(default=None, min_length=1, max_length=1000)
    attachment_path: str | None = Field(default=None, max_length=1000)
    status: Literal["DRAFT", "ACTIVE", "EXPIRED", "INACTIVE"] | None = None
    remark: str | None = None
