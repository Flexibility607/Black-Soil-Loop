from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field, model_validator

from app.schemas.master_data import PatchModel


class EnterpriseCapacityCreate(PatchModel):
    capacity_id: str = Field(min_length=1, max_length=64)
    enterprise_id: str = Field(min_length=1, max_length=64)
    product_category_id: str = Field(min_length=1, max_length=64)
    product_category_name: str = Field(min_length=1, max_length=255)
    daily_capacity: Decimal = Field(gt=0)
    unit: str = Field(min_length=1, max_length=64)
    effective_from: date
    effective_to: date | None = None
    status: Literal["ACTIVE", "INACTIVE"]
    remark: str | None = None


class EnterpriseCapacityPatch(PatchModel):
    product_category_name: str | None = Field(default=None, min_length=1, max_length=255)
    daily_capacity: Decimal | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, min_length=1, max_length=64)
    effective_from: date | None = None
    effective_to: date | None = None
    status: Literal["ACTIVE", "INACTIVE"] | None = None
    remark: str | None = None


class InventoryThresholdRequestCreate(PatchModel):
    threshold_request_id: str = Field(min_length=1, max_length=64)
    inventory_record_id: str = Field(min_length=1, max_length=64)
    enterprise_id: str = Field(min_length=1, max_length=64)
    product_id: str = Field(min_length=1, max_length=64)
    warehouse_id: str = Field(min_length=1, max_length=64)
    safety_stock_qty: Decimal | None = Field(default=None, ge=0)
    target_stock_qty: Decimal | None = Field(default=None, gt=0)
    safety_stock_ratio: Decimal | None = Field(default=None, gt=0, le=1)
    remark: str | None = None

    @model_validator(mode="after")
    def validate_threshold_source(self):
        if self.safety_stock_qty is None and (self.target_stock_qty is None or self.safety_stock_ratio is None):
            raise ValueError("必须提供 safety_stock_qty，或同时提供 target_stock_qty 与 safety_stock_ratio")
        return self


class ApprovalDecision(PatchModel):
    comment: str | None = Field(default=None, max_length=1000)


class TransportTelemetryCreate(PatchModel):
    telemetry_id: str = Field(min_length=1, max_length=64)
    task_id: str = Field(min_length=1, max_length=64)
    vehicle_id: str = Field(min_length=1, max_length=64)
    recorded_at: datetime
    actual_temperature_celsius: Decimal | None = None
    actual_humidity_percent: Decimal | None = Field(default=None, ge=0, le=100)
    latitude: Decimal | None = Field(default=None, ge=-90, le=90)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180)
    anomaly_status: Literal["NORMAL", "TEMPERATURE_ABNORMAL", "HUMIDITY_ABNORMAL", "LOCATION_ABNORMAL", "UNKNOWN"]
    source_type: Literal["INTERNAL", "DEMO_SIMULATION"]
    remark: str | None = None


class ProcurementHistoryCreate(PatchModel):
    purchase_record_id: str = Field(min_length=1, max_length=64)
    enterprise_id: str = Field(min_length=1, max_length=64)
    purchased_at: datetime
    material_id: str = Field(min_length=1, max_length=64)
    material_name: str = Field(min_length=1, max_length=255)
    quantity_kg: Decimal = Field(gt=0)
    unit_price: Decimal = Field(ge=0)
    currency: Literal["CNY"]
    supplier_id: str = Field(min_length=1, max_length=64)
    supplier_name: str = Field(min_length=1, max_length=255)
    supplier_type: Literal["OTHER_PRODUCER", "PARK_DIRECT"]
    status: Literal["VALID", "VOID"]
    remark: str | None = None


class ProcurementHistoryPatch(PatchModel):
    purchased_at: datetime | None = None
    material_name: str | None = Field(default=None, min_length=1, max_length=255)
    quantity_kg: Decimal | None = Field(default=None, gt=0)
    unit_price: Decimal | None = Field(default=None, ge=0)
    currency: Literal["CNY"] | None = None
    supplier_id: str | None = Field(default=None, min_length=1, max_length=64)
    supplier_name: str | None = Field(default=None, min_length=1, max_length=255)
    supplier_type: Literal["OTHER_PRODUCER", "PARK_DIRECT"] | None = None
    status: Literal["VALID", "VOID"] | None = None
    remark: str | None = None
