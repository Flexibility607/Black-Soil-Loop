from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field

from app.schemas.master_data import PatchModel


class InventoryCreate(PatchModel):
    inventory_record_id: str = Field(min_length=1, max_length=64)
    enterprise_id: str = Field(min_length=1, max_length=64)
    warehouse_id: str = Field(min_length=1, max_length=64)
    warehouse_name: str | None = Field(default=None, max_length=255)
    product_id: str = Field(min_length=1, max_length=64)
    product_name: str = Field(min_length=1, max_length=255)
    category_id: str = Field(min_length=1, max_length=128)
    specification: str | None = Field(default=None, max_length=255)
    unit: str = Field(min_length=1, max_length=64)
    supplier_id: str | None = Field(default=None, max_length=64)
    supplier_name: str | None = Field(default=None, max_length=255)
    batch_id: str | None = Field(default=None, max_length=128)
    current_qty: Decimal = Field(ge=0)
    inbound_qty: Decimal | None = Field(default=None, ge=0)
    outbound_qty: Decimal | None = Field(default=None, ge=0)
    adjustment_qty: Decimal | None = None
    count_book_qty: Decimal | None = Field(default=None, ge=0)
    count_actual_qty: Decimal | None = Field(default=None, ge=0)
    production_date: date | None = None
    expiration_date: date | None = None
    stock_lower: Decimal | None = Field(default=None, ge=0)
    stock_upper: Decimal | None = Field(default=None, ge=0)
    recorded_at: datetime
    status: Literal["ACTIVE", "INACTIVE"]
    remark: str | None = None


class InventoryPatch(PatchModel):
    enterprise_id: str | None = Field(default=None, min_length=1, max_length=64)
    warehouse_id: str | None = Field(default=None, min_length=1, max_length=64)
    warehouse_name: str | None = Field(default=None, max_length=255)
    product_id: str | None = Field(default=None, min_length=1, max_length=64)
    product_name: str | None = Field(default=None, min_length=1, max_length=255)
    category_id: str | None = Field(default=None, min_length=1, max_length=128)
    specification: str | None = Field(default=None, max_length=255)
    unit: str | None = Field(default=None, min_length=1, max_length=64)
    supplier_id: str | None = Field(default=None, max_length=64)
    supplier_name: str | None = Field(default=None, max_length=255)
    batch_id: str | None = Field(default=None, max_length=128)
    current_qty: Decimal | None = Field(default=None, ge=0)
    inbound_qty: Decimal | None = Field(default=None, ge=0)
    outbound_qty: Decimal | None = Field(default=None, ge=0)
    adjustment_qty: Decimal | None = None
    count_book_qty: Decimal | None = Field(default=None, ge=0)
    count_actual_qty: Decimal | None = Field(default=None, ge=0)
    production_date: date | None = None
    expiration_date: date | None = None
    stock_lower: Decimal | None = Field(default=None, ge=0)
    stock_upper: Decimal | None = Field(default=None, ge=0)
    recorded_at: datetime | None = None
    status: Literal["ACTIVE", "INACTIVE"] | None = None
    remark: str | None = None


class SalesOrderLineCreate(PatchModel):
    sales_order_id: str = Field(min_length=1, max_length=64)
    line_no: int = Field(ge=1)
    enterprise_id: str = Field(min_length=1, max_length=64)
    customer_id: str | None = Field(default=None, max_length=64)
    customer_name: str | None = Field(default=None, max_length=255)
    customer_phone: str | None = Field(default=None, max_length=64)
    customer_address: str | None = Field(default=None, max_length=500)
    ordered_at: datetime
    delivery_at: datetime | None = None
    product_id: str = Field(min_length=1, max_length=64)
    product_name: str = Field(min_length=1, max_length=255)
    quantity: Decimal = Field(gt=0)
    unit: str = Field(min_length=1, max_length=64)
    order_amount: Decimal | None = Field(default=None, ge=0)
    discount_amount: Decimal | None = Field(default=None, ge=0)
    received_amount: Decimal | None = Field(default=None, ge=0)
    currency: Literal["CNY"]
    payment_status: Literal["UNKNOWN", "PAID", "PARTIAL", "UNPAID"] | None = None
    status: Literal["DRAFT", "CONFIRMED", "COMPLETED", "CANCELLED"]
    remark: str | None = None


class SalesOrderLinePatch(PatchModel):
    enterprise_id: str | None = Field(default=None, min_length=1, max_length=64)
    customer_id: str | None = Field(default=None, max_length=64)
    customer_name: str | None = Field(default=None, max_length=255)
    customer_phone: str | None = Field(default=None, max_length=64)
    customer_address: str | None = Field(default=None, max_length=500)
    ordered_at: datetime | None = None
    delivery_at: datetime | None = None
    product_id: str | None = Field(default=None, min_length=1, max_length=64)
    product_name: str | None = Field(default=None, min_length=1, max_length=255)
    quantity: Decimal | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, min_length=1, max_length=64)
    order_amount: Decimal | None = Field(default=None, ge=0)
    discount_amount: Decimal | None = Field(default=None, ge=0)
    received_amount: Decimal | None = Field(default=None, ge=0)
    currency: Literal["CNY"] | None = None
    payment_status: Literal["UNKNOWN", "PAID", "PARTIAL", "UNPAID"] | None = None
    status: Literal["DRAFT", "CONFIRMED", "COMPLETED", "CANCELLED"] | None = None
    remark: str | None = None


class ReturnRecordCreate(PatchModel):
    return_id: str = Field(min_length=1, max_length=64)
    sales_order_id: str = Field(min_length=1, max_length=64)
    line_no: int | None = Field(default=None, ge=1)
    enterprise_id: str = Field(min_length=1, max_length=64)
    product_id: str = Field(min_length=1, max_length=64)
    product_name: str = Field(min_length=1, max_length=255)
    quantity: Decimal = Field(gt=0)
    unit: str = Field(min_length=1, max_length=64)
    reason: str = Field(min_length=1)
    amount: Decimal | None = Field(default=None, ge=0)
    currency: Literal["CNY"]
    returned_at: datetime
    status: Literal["DRAFT", "CONFIRMED", "COMPLETED", "CANCELLED"]
    remark: str | None = None


class ReturnRecordPatch(PatchModel):
    sales_order_id: str | None = Field(default=None, min_length=1, max_length=64)
    line_no: int | None = Field(default=None, ge=1)
    enterprise_id: str | None = Field(default=None, min_length=1, max_length=64)
    product_id: str | None = Field(default=None, min_length=1, max_length=64)
    product_name: str | None = Field(default=None, min_length=1, max_length=255)
    quantity: Decimal | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, min_length=1, max_length=64)
    reason: str | None = Field(default=None, min_length=1)
    amount: Decimal | None = Field(default=None, ge=0)
    currency: Literal["CNY"] | None = None
    returned_at: datetime | None = None
    status: Literal["DRAFT", "CONFIRMED", "COMPLETED", "CANCELLED"] | None = None
    remark: str | None = None
