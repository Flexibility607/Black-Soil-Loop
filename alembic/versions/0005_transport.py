"""create B01 transport and freezer tables

Revision ID: 0005_transport
Revises: 0004_business_records
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_transport"
down_revision: Union[str, Sequence[str], None] = "0004_business_records"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def tracked_columns() -> list[sa.Column]:
    return [
        sa.Column("source_system", sa.String(length=64), nullable=False),
        sa.Column("source_record_id", sa.String(length=128), nullable=False),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("remark", sa.Text(), nullable=True),
        sa.Column("object_version", sa.Integer(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "transport_task_summaries",
        sa.Column("task_id", sa.String(length=64), nullable=False),
        sa.Column("order_id", sa.String(length=64), nullable=False),
        sa.Column("enterprise_id", sa.String(length=64), nullable=False),
        sa.Column("partner_id", sa.String(length=64), nullable=True),
        sa.Column("store_id", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("status_version", sa.Integer(), nullable=False),
        sa.Column("planned_depart_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("planned_arrive_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("origin", sa.String(length=500), nullable=False),
        sa.Column("destination", sa.String(length=500), nullable=False),
        sa.Column("vehicle_id", sa.String(length=64), nullable=True),
        sa.Column("driver_id", sa.String(length=64), nullable=True),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("task_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_transport_task_summaries_source"),
    )
    op.create_index("ix_transport_task_summaries_order_id", "transport_task_summaries", ["order_id"], unique=False)
    op.create_index("ix_transport_task_summaries_enterprise_id", "transport_task_summaries", ["enterprise_id"], unique=False)

    op.create_table(
        "transport_resources",
        sa.Column("driver_id", sa.String(length=64), nullable=False),
        sa.Column("driver_name", sa.String(length=128), nullable=False),
        sa.Column("driver_phone", sa.String(length=64), nullable=True),
        sa.Column("vehicle_id", sa.String(length=64), nullable=False),
        sa.Column("plate_no", sa.String(length=64), nullable=True),
        sa.Column("mass_capacity_kg", sa.Numeric(20, 6), nullable=True),
        sa.Column("volume_capacity_m3", sa.Numeric(20, 6), nullable=True),
        sa.Column("temperature_min_celsius", sa.Numeric(10, 4), nullable=True),
        sa.Column("temperature_max_celsius", sa.Numeric(10, 4), nullable=True),
        sa.Column("on_duty", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("driver_id", "vehicle_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_transport_resources_source"),
    )

    op.create_table(
        "freezer_records",
        sa.Column("freezer_id", sa.String(length=64), nullable=False),
        sa.Column("park_id", sa.String(length=64), nullable=False),
        sa.Column("enterprise_id", sa.String(length=64), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("frozen_goods_kg", sa.Numeric(20, 6), nullable=False),
        sa.Column("used_volume_m3", sa.Numeric(20, 6), nullable=False),
        sa.Column("total_volume_m3", sa.Numeric(20, 6), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("freezer_id", "recorded_at"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_freezer_records_source"),
    )
    op.create_index("ix_freezer_records_park_id", "freezer_records", ["park_id"], unique=False)
    op.create_index("ix_freezer_records_enterprise_id", "freezer_records", ["enterprise_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_freezer_records_enterprise_id", table_name="freezer_records")
    op.drop_index("ix_freezer_records_park_id", table_name="freezer_records")
    op.drop_table("freezer_records")
    op.drop_table("transport_resources")
    op.drop_index("ix_transport_task_summaries_enterprise_id", table_name="transport_task_summaries")
    op.drop_index("ix_transport_task_summaries_order_id", table_name="transport_task_summaries")
    op.drop_table("transport_task_summaries")
