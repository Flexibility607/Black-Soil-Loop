from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.master_data import SourceTrackedMixin


class Inventory(SourceTrackedMixin, Base):
    __tablename__ = "inventories"

    inventory_record_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    enterprise_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    warehouse_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    warehouse_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    product_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    category_id: Mapped[str] = mapped_column(String(128), nullable=False)
    specification: Mapped[str | None] = mapped_column(String(255), nullable=True)
    unit: Mapped[str] = mapped_column(String(64), nullable=False)
    supplier_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    supplier_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    batch_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    current_qty: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False)
    inbound_qty: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    outbound_qty: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    adjustment_qty: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    count_book_qty: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    count_actual_qty: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    production_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expiration_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    stock_lower: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    stock_upper: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)


class SalesOrderLine(SourceTrackedMixin, Base):
    __tablename__ = "sales_order_lines"

    sales_order_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    line_no: Mapped[int] = mapped_column(Integer, primary_key=True)
    enterprise_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    customer_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    customer_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ordered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    delivery_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    product_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False)
    unit: Mapped[str] = mapped_column(String(64), nullable=False)
    order_amount: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    discount_amount: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    received_amount: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    payment_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)


class ReturnRecord(SourceTrackedMixin, Base):
    __tablename__ = "returns"

    return_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sales_order_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    line_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    enterprise_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    product_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[float] = mapped_column(Numeric(20, 6), nullable=False)
    unit: Mapped[str] = mapped_column(String(64), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    amount: Mapped[float | None] = mapped_column(Numeric(20, 6), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    returned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
