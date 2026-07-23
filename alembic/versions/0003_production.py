"""create B01 production and BOM tables

Revision ID: 0003_production
Revises: 0002_master_data
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_production"
down_revision: Union[str, Sequence[str], None] = "0002_master_data"
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
        "production_plans",
        sa.Column("plan_id", sa.String(length=64), nullable=False),
        sa.Column("enterprise_id", sa.String(length=64), nullable=False),
        sa.Column("product_id", sa.String(length=64), nullable=False),
        sa.Column("product_name", sa.String(length=255), nullable=False),
        sa.Column("specification", sa.String(length=255), nullable=True),
        sa.Column("planned_quantity", sa.Numeric(20, 6), nullable=False),
        sa.Column("unit", sa.String(length=64), nullable=False),
        sa.Column("qualified_quantity", sa.Numeric(20, 6), nullable=True),
        sa.Column("planned_start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("planned_end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workshop", sa.String(length=255), nullable=True),
        sa.Column("owner", sa.String(length=128), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("plan_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_production_plans_source"),
    )
    op.create_index("ix_production_plans_enterprise_id", "production_plans", ["enterprise_id"], unique=False)
    op.create_index("ix_production_plans_product_id", "production_plans", ["product_id"], unique=False)

    op.create_table(
        "production_orders",
        sa.Column("production_order_id", sa.String(length=64), nullable=False),
        sa.Column("plan_id", sa.String(length=64), nullable=True),
        sa.Column("enterprise_id", sa.String(length=64), nullable=False),
        sa.Column("product_id", sa.String(length=64), nullable=False),
        sa.Column("product_name", sa.String(length=255), nullable=False),
        sa.Column("quantity", sa.Numeric(20, 6), nullable=False),
        sa.Column("unit", sa.String(length=64), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=True),
        sa.Column("process_requirement", sa.Text(), nullable=True),
        sa.Column("quality_requirement", sa.Text(), nullable=True),
        sa.Column("actual_qty", sa.Numeric(20, 6), nullable=True),
        sa.Column("ordered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("production_order_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_production_orders_source"),
    )
    op.create_index("ix_production_orders_plan_id", "production_orders", ["plan_id"], unique=False)
    op.create_index("ix_production_orders_enterprise_id", "production_orders", ["enterprise_id"], unique=False)
    op.create_index("ix_production_orders_product_id", "production_orders", ["product_id"], unique=False)

    op.create_table(
        "boms",
        sa.Column("bom_id", sa.String(length=64), nullable=False),
        sa.Column("enterprise_id", sa.String(length=64), nullable=True),
        sa.Column("product_id", sa.String(length=64), nullable=False),
        sa.Column("product_name", sa.String(length=255), nullable=False),
        sa.Column("material_id", sa.String(length=64), nullable=False),
        sa.Column("material_name", sa.String(length=255), nullable=False),
        sa.Column("unit_usage_kg", sa.Numeric(20, 6), nullable=False),
        sa.Column("unit_usage_unit", sa.String(length=64), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=True),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("bom_id", "product_id", "material_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_boms_source"),
    )
    op.create_index("ix_boms_enterprise_id", "boms", ["enterprise_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_boms_enterprise_id", table_name="boms")
    op.drop_table("boms")
    op.drop_index("ix_production_orders_product_id", table_name="production_orders")
    op.drop_index("ix_production_orders_enterprise_id", table_name="production_orders")
    op.drop_index("ix_production_orders_plan_id", table_name="production_orders")
    op.drop_table("production_orders")
    op.drop_index("ix_production_plans_product_id", table_name="production_plans")
    op.drop_index("ix_production_plans_enterprise_id", table_name="production_plans")
    op.drop_table("production_plans")
