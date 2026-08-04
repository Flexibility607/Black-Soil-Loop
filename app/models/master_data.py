from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from app.db.base import Base


class SourceTrackedMixin:
    @declared_attr.directive
    def __table_args__(cls):
        return (UniqueConstraint("source_system", "source_record_id", name=f"uq_{cls.__tablename__}_source"),)

    source_system: Mapped[str] = mapped_column(String(64), nullable=False)
    source_record_id: Mapped[str] = mapped_column(String(128), nullable=False)
    source_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    object_version: Mapped[int] = mapped_column(nullable=False, default=1)


class Park(SourceTrackedMixin, Base):
    __tablename__ = "parks"

    park_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    park_name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    longitude: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)


class Enterprise(SourceTrackedMixin, Base):
    __tablename__ = "enterprises"

    enterprise_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    park_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    enterprise_name: Mapped[str] = mapped_column(String(255), nullable=False)
    industry: Mapped[str] = mapped_column(String(128), nullable=False)
    enterprise_contact_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    enterprise_phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    enterprise_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)


class EnterpriseTag(SourceTrackedMixin, Base):
    __tablename__ = "enterprise_tags"

    enterprise_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tag: Mapped[str] = mapped_column(String(128), primary_key=True)


class Partner(SourceTrackedMixin, Base):
    __tablename__ = "partners"

    partner_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    partner_name: Mapped[str] = mapped_column(String(255), nullable=False)
    partner_type: Mapped[str] = mapped_column(String(128), nullable=False)
    partner_contact_name: Mapped[str] = mapped_column(String(128), nullable=False)
    partner_phone: Mapped[str] = mapped_column(String(64), nullable=False)
    partner_address: Mapped[str] = mapped_column(String(500), nullable=False)
    relationship_status: Mapped[str] = mapped_column(String(32), nullable=False)


class Store(SourceTrackedMixin, Base):
    __tablename__ = "stores"
    __table_args__ = (
        UniqueConstraint("source_system", "source_record_id", name="uq_stores_source"),
        CheckConstraint(
            "channel_type IS NULL OR channel_type IN ('TRADITIONAL_STORE', 'THIRD_SPACE')",
            name="ck_stores_channel_type",
        ),
    )

    store_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    enterprise_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    partner_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    park_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    channel_type: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    reporting_authorized: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    store_name: Mapped[str] = mapped_column(String(255), nullable=False)
    store_contact_name: Mapped[str] = mapped_column(String(128), nullable=False)
    store_phone: Mapped[str] = mapped_column(String(64), nullable=False)
    delivery_address: Mapped[str] = mapped_column(String(500), nullable=False)
    city: Mapped[str | None] = mapped_column(String(128), nullable=True)
    longitude: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    relationship_status: Mapped[str] = mapped_column(String(32), nullable=False)
