from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field

from app.schemas.master_data import PatchModel


class TransportTaskSummaryCreate(PatchModel):
    task_id: str = Field(min_length=1, max_length=64)
    order_id: str = Field(min_length=1, max_length=64)
    enterprise_id: str = Field(min_length=1, max_length=64)
    partner_id: str | None = Field(default=None, max_length=64)
    store_id: str | None = Field(default=None, max_length=64)
    status: Literal["DRAFT", "CONFIRMED", "CANCELLED"]
    status_version: int = Field(ge=1)
    planned_depart_at: datetime | None = None
    planned_arrive_at: datetime | None = None
    origin: str = Field(min_length=1, max_length=500)
    destination: str = Field(min_length=1, max_length=500)
    vehicle_id: str | None = Field(default=None, max_length=64)
    driver_id: str | None = Field(default=None, max_length=64)
    remark: str | None = None


class TransportTaskSummaryPatch(PatchModel):
    order_id: str | None = Field(default=None, min_length=1, max_length=64)
    enterprise_id: str | None = Field(default=None, min_length=1, max_length=64)
    partner_id: str | None = Field(default=None, max_length=64)
    store_id: str | None = Field(default=None, max_length=64)
    status: Literal["DRAFT", "CONFIRMED", "CANCELLED"] | None = None
    status_version: int | None = Field(default=None, ge=1)
    planned_depart_at: datetime | None = None
    planned_arrive_at: datetime | None = None
    origin: str | None = Field(default=None, min_length=1, max_length=500)
    destination: str | None = Field(default=None, min_length=1, max_length=500)
    vehicle_id: str | None = Field(default=None, max_length=64)
    driver_id: str | None = Field(default=None, max_length=64)
    remark: str | None = None


class TransportResourceCreate(PatchModel):
    driver_id: str = Field(min_length=1, max_length=64)
    driver_name: str = Field(min_length=1, max_length=128)
    driver_phone: str | None = Field(default=None, max_length=64)
    vehicle_id: str = Field(min_length=1, max_length=64)
    plate_no: str | None = Field(default=None, max_length=64)
    mass_capacity_kg: Decimal | None = Field(default=None, ge=0)
    volume_capacity_m3: Decimal | None = Field(default=None, ge=0)
    temperature_min_celsius: Decimal | None = None
    temperature_max_celsius: Decimal | None = None
    on_duty: bool
    status: Literal["ACTIVE", "INACTIVE"]
    remark: str | None = None


class TransportResourcePatch(PatchModel):
    driver_name: str | None = Field(default=None, min_length=1, max_length=128)
    driver_phone: str | None = Field(default=None, max_length=64)
    plate_no: str | None = Field(default=None, max_length=64)
    mass_capacity_kg: Decimal | None = Field(default=None, ge=0)
    volume_capacity_m3: Decimal | None = Field(default=None, ge=0)
    temperature_min_celsius: Decimal | None = None
    temperature_max_celsius: Decimal | None = None
    on_duty: bool | None = None
    status: Literal["ACTIVE", "INACTIVE"] | None = None
    remark: str | None = None


class FreezerRecordCreate(PatchModel):
    freezer_id: str = Field(min_length=1, max_length=64)
    park_id: str = Field(min_length=1, max_length=64)
    enterprise_id: str | None = Field(default=None, max_length=64)
    recorded_at: datetime
    frozen_goods_kg: Decimal = Field(ge=0)
    used_volume_m3: Decimal = Field(ge=0)
    total_volume_m3: Decimal = Field(ge=0)
    status: Literal["ACTIVE", "INACTIVE"]
    remark: str | None = None


class FreezerRecordPatch(PatchModel):
    park_id: str | None = Field(default=None, min_length=1, max_length=64)
    enterprise_id: str | None = Field(default=None, max_length=64)
    recorded_at: datetime | None = None
    frozen_goods_kg: Decimal | None = Field(default=None, ge=0)
    used_volume_m3: Decimal | None = Field(default=None, ge=0)
    total_volume_m3: Decimal | None = Field(default=None, ge=0)
    status: Literal["ACTIVE", "INACTIVE"] | None = None
    remark: str | None = None
