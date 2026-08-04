from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class B02ServiceNonce(Base):
    __tablename__ = "b02_service_nonces"

    service_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    nonce: Mapped[str] = mapped_column(String(128), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)


class B02InboxEvent(Base):
    __tablename__ = "b02_inbox_events"
    __table_args__ = (
        UniqueConstraint(
            "object_type",
            "object_id",
            "object_version",
            name="uq_b02_inbox_object_version",
        ),
    )

    event_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    trace_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    body_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    object_type: Mapped[str] = mapped_column(String(64), nullable=False)
    object_id: Mapped[str] = mapped_column(String(256), nullable=False)
    object_version: Mapped[int] = mapped_column(Integer, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    result_code: Mapped[str] = mapped_column(String(64), nullable=False)
    result_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class StoreOperationSummary(Base):
    __tablename__ = "store_operation_summaries"

    object_id: Mapped[str] = mapped_column(String(256), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    partner_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    store_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    period_start: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    period_end: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    report_status: Mapped[str] = mapped_column(String(32), nullable=False)
    sales_amount: Mapped[Decimal | None] = mapped_column(Numeric(20, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    order_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    average_order_amount: Mapped[Decimal | None] = mapped_column(Numeric(20, 2), nullable=True)
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(20, 6), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(64), nullable=True)
    loss_quantity: Mapped[Decimal | None] = mapped_column(Numeric(20, 6), nullable=True)
    closing_inventory: Mapped[Decimal | None] = mapped_column(Numeric(20, 6), nullable=True)
    submitted_count: Mapped[int] = mapped_column(Integer, nullable=False)
    missing_items: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    report_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    store_operation_version: Mapped[int] = mapped_column(Integer, nullable=False)
    source_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AssistantRateWindow(Base):
    __tablename__ = "assistant_rate_windows"

    client_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    request_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_request_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    route: Mapped[str] = mapped_column(String(64), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
