"""add dashboard channels and B02 projections

Revision ID: 0010_dashboard_channels
Revises: 0009_single_device_sessions
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010_dashboard_channels"
down_revision: str | Sequence[str] | None = "0009_single_device_sessions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("parks") as batch_op:
        batch_op.add_column(sa.Column("longitude", sa.Numeric(10, 7), nullable=True))
        batch_op.add_column(sa.Column("latitude", sa.Numeric(10, 7), nullable=True))

    with op.batch_alter_table("stores") as batch_op:
        batch_op.add_column(sa.Column("park_id", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("channel_type", sa.String(length=32), nullable=True))
        batch_op.add_column(
            sa.Column("reporting_authorized", sa.Boolean(), server_default=sa.false(), nullable=False)
        )
        batch_op.add_column(sa.Column("city", sa.String(length=128), nullable=True))
        batch_op.create_index("ix_stores_park_id", ["park_id"], unique=False)
        batch_op.create_index("ix_stores_channel_type", ["channel_type"], unique=False)
        batch_op.create_foreign_key("fk_stores_park_id_parks", "parks", ["park_id"], ["park_id"])
        batch_op.create_check_constraint(
            "ck_stores_channel_type",
            "channel_type IS NULL OR channel_type IN ('TRADITIONAL_STORE', 'THIRD_SPACE')",
        )

    op.create_table(
        "b02_service_nonces",
        sa.Column("service_id", sa.String(length=32), nullable=False),
        sa.Column("nonce", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("service_id", "nonce"),
    )
    op.create_index("ix_b02_service_nonces_created_at", "b02_service_nonces", ["created_at"], unique=False)

    op.create_table(
        "b02_inbox_events",
        sa.Column("event_id", sa.String(length=128), nullable=False),
        sa.Column("trace_id", sa.String(length=64), nullable=False),
        sa.Column("body_sha256", sa.String(length=64), nullable=False),
        sa.Column("object_type", sa.String(length=64), nullable=False),
        sa.Column("object_id", sa.String(length=256), nullable=False),
        sa.Column("object_version", sa.Integer(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("result_code", sa.String(length=64), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("event_id"),
        sa.UniqueConstraint("object_type", "object_id", "object_version", name="uq_b02_inbox_object_version"),
    )
    op.create_index("ix_b02_inbox_events_trace_id", "b02_inbox_events", ["trace_id"], unique=False)

    op.create_table(
        "store_operation_summaries",
        sa.Column("object_id", sa.String(length=256), nullable=False),
        sa.Column("event_id", sa.String(length=128), nullable=False),
        sa.Column("partner_id", sa.String(length=64), nullable=False),
        sa.Column("store_id", sa.String(length=64), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("report_status", sa.String(length=32), nullable=False),
        sa.Column("sales_amount", sa.Numeric(20, 2), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("order_count", sa.Integer(), nullable=True),
        sa.Column("average_order_amount", sa.Numeric(20, 2), nullable=True),
        sa.Column("quantity", sa.Numeric(20, 6), nullable=True),
        sa.Column("unit", sa.String(length=64), nullable=True),
        sa.Column("loss_quantity", sa.Numeric(20, 6), nullable=True),
        sa.Column("closing_inventory", sa.Numeric(20, 6), nullable=True),
        sa.Column("submitted_count", sa.Integer(), nullable=False),
        sa.Column("missing_items", sa.JSON(), nullable=False),
        sa.Column("report_version", sa.Integer(), nullable=True),
        sa.Column("store_operation_version", sa.Integer(), nullable=False),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("object_id"),
        sa.UniqueConstraint("event_id"),
    )
    op.create_index("ix_store_operation_summaries_partner_id", "store_operation_summaries", ["partner_id"], unique=False)
    op.create_index("ix_store_operation_summaries_store_id", "store_operation_summaries", ["store_id"], unique=False)
    op.create_index("ix_store_operation_summaries_period_start", "store_operation_summaries", ["period_start"], unique=False)
    op.create_index("ix_store_operation_summaries_period_end", "store_operation_summaries", ["period_end"], unique=False)

    op.create_table(
        "assistant_rate_windows",
        sa.Column("client_hash", sa.String(length=64), nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False),
        sa.Column("last_request_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("route", sa.String(length=64), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("client_hash", "route", "window_started_at"),
    )


def downgrade() -> None:
    op.drop_table("assistant_rate_windows")
    op.drop_index("ix_store_operation_summaries_period_end", table_name="store_operation_summaries")
    op.drop_index("ix_store_operation_summaries_period_start", table_name="store_operation_summaries")
    op.drop_index("ix_store_operation_summaries_store_id", table_name="store_operation_summaries")
    op.drop_index("ix_store_operation_summaries_partner_id", table_name="store_operation_summaries")
    op.drop_table("store_operation_summaries")
    op.drop_index("ix_b02_inbox_events_trace_id", table_name="b02_inbox_events")
    op.drop_table("b02_inbox_events")
    op.drop_index("ix_b02_service_nonces_created_at", table_name="b02_service_nonces")
    op.drop_table("b02_service_nonces")
    with op.batch_alter_table("stores") as batch_op:
        batch_op.drop_constraint("ck_stores_channel_type", type_="check")
        batch_op.drop_constraint("fk_stores_park_id_parks", type_="foreignkey")
        batch_op.drop_index("ix_stores_channel_type")
        batch_op.drop_index("ix_stores_park_id")
        batch_op.drop_column("city")
        batch_op.drop_column("reporting_authorized")
        batch_op.drop_column("channel_type")
        batch_op.drop_column("park_id")
    with op.batch_alter_table("parks") as batch_op:
        batch_op.drop_column("latitude")
        batch_op.drop_column("longitude")
