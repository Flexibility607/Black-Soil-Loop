"""add leadership feedback business fields and operation tables

Revision ID: 0008_leadership_feedback
Revises: 0007_import_batches
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008_leadership_feedback"
down_revision: Union[str, Sequence[str], None] = "0007_import_batches"
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
    op.add_column("users", sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("stores", sa.Column("enterprise_id", sa.String(length=64), nullable=True))
    op.create_index("ix_stores_enterprise_id", "stores", ["enterprise_id"], unique=False)
    op.add_column("preorders", sa.Column("enterprise_id", sa.String(length=64), nullable=True))
    op.create_index("ix_preorders_enterprise_id", "preorders", ["enterprise_id"], unique=False)
    op.add_column("production_orders", sa.Column("preorder_id", sa.String(length=64), nullable=True))
    op.create_index("ix_production_orders_preorder_id", "production_orders", ["preorder_id"], unique=False)
    op.add_column("policies", sa.Column("source_type", sa.String(length=32), nullable=True))
    op.add_column("transport_task_summaries", sa.Column("vehicle_type_id", sa.String(length=64), nullable=True))
    op.add_column("transport_task_summaries", sa.Column("vehicle_type_name", sa.String(length=128), nullable=True))
    op.add_column("transport_task_summaries", sa.Column("required_vehicle_count", sa.Integer(), nullable=True))
    op.add_column("transport_task_summaries", sa.Column("estimated_fee", sa.Numeric(20, 6), nullable=True))
    op.add_column("transport_task_summaries", sa.Column("currency", sa.String(length=3), nullable=True))
    op.add_column("transport_resources", sa.Column("vehicle_type_id", sa.String(length=64), nullable=True))
    op.add_column("transport_resources", sa.Column("vehicle_type_name", sa.String(length=128), nullable=True))
    op.add_column("transport_resources", sa.Column("humidity_min_percent", sa.Numeric(10, 4), nullable=True))
    op.add_column("transport_resources", sa.Column("humidity_max_percent", sa.Numeric(10, 4), nullable=True))

    op.create_table(
        "enterprise_capacities",
        sa.Column("capacity_id", sa.String(length=64), nullable=False),
        sa.Column("enterprise_id", sa.String(length=64), nullable=False),
        sa.Column("product_category_id", sa.String(length=64), nullable=False),
        sa.Column("product_category_name", sa.String(length=255), nullable=False),
        sa.Column("daily_capacity", sa.Numeric(20, 6), nullable=False),
        sa.Column("unit", sa.String(length=64), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("capacity_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_enterprise_capacities_source"),
    )
    op.create_index("ix_enterprise_capacities_enterprise_id", "enterprise_capacities", ["enterprise_id"], unique=False)
    op.create_index("ix_enterprise_capacities_product_category_id", "enterprise_capacities", ["product_category_id"], unique=False)

    op.create_table(
        "inventory_threshold_requests",
        sa.Column("threshold_request_id", sa.String(length=64), nullable=False),
        sa.Column("inventory_record_id", sa.String(length=64), nullable=False),
        sa.Column("enterprise_id", sa.String(length=64), nullable=False),
        sa.Column("product_id", sa.String(length=64), nullable=False),
        sa.Column("warehouse_id", sa.String(length=64), nullable=False),
        sa.Column("safety_stock_qty", sa.Numeric(20, 6), nullable=True),
        sa.Column("target_stock_qty", sa.Numeric(20, 6), nullable=True),
        sa.Column("safety_stock_ratio", sa.Numeric(10, 6), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("submitted_by", sa.String(length=64), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_by", sa.String(length=64), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("effective_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approval_comment", sa.Text(), nullable=True),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("threshold_request_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_inventory_threshold_requests_source"),
    )
    op.create_index("ix_inventory_threshold_requests_inventory_record_id", "inventory_threshold_requests", ["inventory_record_id"], unique=False)
    op.create_index("ix_inventory_threshold_requests_enterprise_id", "inventory_threshold_requests", ["enterprise_id"], unique=False)
    op.create_index("ix_inventory_threshold_requests_product_id", "inventory_threshold_requests", ["product_id"], unique=False)
    op.create_index("ix_inventory_threshold_requests_status", "inventory_threshold_requests", ["status"], unique=False)

    op.create_table(
        "inventory_alerts",
        sa.Column("alert_id", sa.String(length=64), nullable=False),
        sa.Column("inventory_record_id", sa.String(length=64), nullable=False),
        sa.Column("enterprise_id", sa.String(length=64), nullable=False),
        sa.Column("product_id", sa.String(length=64), nullable=False),
        sa.Column("warehouse_id", sa.String(length=64), nullable=False),
        sa.Column("current_qty", sa.Numeric(20, 6), nullable=False),
        sa.Column("threshold_qty", sa.Numeric(20, 6), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged_by", sa.String(length=64), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("remark", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("alert_id"),
    )
    op.create_index("ix_inventory_alerts_inventory_record_id", "inventory_alerts", ["inventory_record_id"], unique=False)
    op.create_index("ix_inventory_alerts_enterprise_id", "inventory_alerts", ["enterprise_id"], unique=False)
    op.create_index("ix_inventory_alerts_product_id", "inventory_alerts", ["product_id"], unique=False)
    op.create_index("ix_inventory_alerts_status", "inventory_alerts", ["status"], unique=False)

    op.create_table(
        "transport_telemetry",
        sa.Column("telemetry_id", sa.String(length=64), nullable=False),
        sa.Column("task_id", sa.String(length=64), nullable=False),
        sa.Column("vehicle_id", sa.String(length=64), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actual_temperature_celsius", sa.Numeric(10, 4), nullable=True),
        sa.Column("actual_humidity_percent", sa.Numeric(10, 4), nullable=True),
        sa.Column("latitude", sa.Numeric(10, 7), nullable=True),
        sa.Column("longitude", sa.Numeric(10, 7), nullable=True),
        sa.Column("anomaly_status", sa.String(length=32), nullable=False),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("telemetry_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_transport_telemetry_source"),
    )
    op.create_index("ix_transport_telemetry_task_id", "transport_telemetry", ["task_id"], unique=False)
    op.create_index("ix_transport_telemetry_vehicle_id", "transport_telemetry", ["vehicle_id"], unique=False)
    op.create_index("ix_transport_telemetry_recorded_at", "transport_telemetry", ["recorded_at"], unique=False)

    op.create_table(
        "procurement_history",
        sa.Column("purchase_record_id", sa.String(length=64), nullable=False),
        sa.Column("enterprise_id", sa.String(length=64), nullable=False),
        sa.Column("purchased_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("material_id", sa.String(length=64), nullable=False),
        sa.Column("material_name", sa.String(length=255), nullable=False),
        sa.Column("quantity_kg", sa.Numeric(20, 6), nullable=False),
        sa.Column("unit_price", sa.Numeric(20, 6), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("supplier_id", sa.String(length=64), nullable=False),
        sa.Column("supplier_name", sa.String(length=255), nullable=False),
        sa.Column("supplier_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("purchase_record_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_procurement_history_source"),
    )
    op.create_index("ix_procurement_history_enterprise_id", "procurement_history", ["enterprise_id"], unique=False)
    op.create_index("ix_procurement_history_purchased_at", "procurement_history", ["purchased_at"], unique=False)
    op.create_index("ix_procurement_history_material_id", "procurement_history", ["material_id"], unique=False)

    op.create_table(
        "calculation_runs",
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("calculation_type", sa.String(length=64), nullable=False),
        sa.Column("enterprise_id", sa.String(length=64), nullable=True),
        sa.Column("input_json", sa.JSON(), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=False),
        sa.Column("rules_version", sa.String(length=32), nullable=False),
        sa.Column("calculation_status", sa.String(length=32), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("run_id"),
    )
    op.create_index("ix_calculation_runs_calculation_type", "calculation_runs", ["calculation_type"], unique=False)
    op.create_index("ix_calculation_runs_enterprise_id", "calculation_runs", ["enterprise_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_calculation_runs_enterprise_id", table_name="calculation_runs")
    op.drop_index("ix_calculation_runs_calculation_type", table_name="calculation_runs")
    op.drop_table("calculation_runs")
    op.drop_index("ix_procurement_history_material_id", table_name="procurement_history")
    op.drop_index("ix_procurement_history_purchased_at", table_name="procurement_history")
    op.drop_index("ix_procurement_history_enterprise_id", table_name="procurement_history")
    op.drop_table("procurement_history")
    op.drop_index("ix_transport_telemetry_recorded_at", table_name="transport_telemetry")
    op.drop_index("ix_transport_telemetry_vehicle_id", table_name="transport_telemetry")
    op.drop_index("ix_transport_telemetry_task_id", table_name="transport_telemetry")
    op.drop_table("transport_telemetry")
    op.drop_index("ix_inventory_alerts_status", table_name="inventory_alerts")
    op.drop_index("ix_inventory_alerts_product_id", table_name="inventory_alerts")
    op.drop_index("ix_inventory_alerts_enterprise_id", table_name="inventory_alerts")
    op.drop_index("ix_inventory_alerts_inventory_record_id", table_name="inventory_alerts")
    op.drop_table("inventory_alerts")
    op.drop_index("ix_inventory_threshold_requests_status", table_name="inventory_threshold_requests")
    op.drop_index("ix_inventory_threshold_requests_product_id", table_name="inventory_threshold_requests")
    op.drop_index("ix_inventory_threshold_requests_enterprise_id", table_name="inventory_threshold_requests")
    op.drop_index("ix_inventory_threshold_requests_inventory_record_id", table_name="inventory_threshold_requests")
    op.drop_table("inventory_threshold_requests")
    op.drop_index("ix_enterprise_capacities_product_category_id", table_name="enterprise_capacities")
    op.drop_index("ix_enterprise_capacities_enterprise_id", table_name="enterprise_capacities")
    op.drop_table("enterprise_capacities")
    op.drop_column("transport_resources", "humidity_max_percent")
    op.drop_column("transport_resources", "humidity_min_percent")
    op.drop_column("transport_resources", "vehicle_type_name")
    op.drop_column("transport_resources", "vehicle_type_id")
    op.drop_column("transport_task_summaries", "currency")
    op.drop_column("transport_task_summaries", "estimated_fee")
    op.drop_column("transport_task_summaries", "required_vehicle_count")
    op.drop_column("transport_task_summaries", "vehicle_type_name")
    op.drop_column("transport_task_summaries", "vehicle_type_id")
    op.drop_column("policies", "source_type")
    op.drop_index("ix_production_orders_preorder_id", table_name="production_orders")
    op.drop_column("production_orders", "preorder_id")
    op.drop_index("ix_preorders_enterprise_id", table_name="preorders")
    op.drop_column("preorders", "enterprise_id")
    op.drop_index("ix_stores_enterprise_id", table_name="stores")
    op.drop_column("stores", "enterprise_id")
    op.drop_column("users", "last_activity_at")
