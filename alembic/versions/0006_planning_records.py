"""create B01 preorder, procurement, quote and policy tables

Revision ID: 0006_planning_records
Revises: 0005_transport
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_planning_records"
down_revision: Union[str, Sequence[str], None] = "0005_transport"
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
        "preorders",
        sa.Column("preorder_id", sa.String(length=64), nullable=False),
        sa.Column("partner_id", sa.String(length=64), nullable=False),
        sa.Column("store_id", sa.String(length=64), nullable=False),
        sa.Column("product_id", sa.String(length=64), nullable=False),
        sa.Column("product_name", sa.String(length=255), nullable=False),
        sa.Column("quantity", sa.Numeric(20, 6), nullable=False),
        sa.Column("unit", sa.String(length=64), nullable=False),
        sa.Column("required_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=True),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("preorder_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_preorders_source"),
    )
    op.create_index("ix_preorders_partner_id", "preorders", ["partner_id"], unique=False)
    op.create_index("ix_preorders_store_id", "preorders", ["store_id"], unique=False)
    op.create_index("ix_preorders_product_id", "preorders", ["product_id"], unique=False)
    op.create_index("ix_preorders_required_at", "preorders", ["required_at"], unique=False)

    op.create_table(
        "procurement_demands",
        sa.Column("demand_id", sa.String(length=64), nullable=False),
        sa.Column("enterprise_id", sa.String(length=64), nullable=False),
        sa.Column("material_id", sa.String(length=64), nullable=False),
        sa.Column("material_name", sa.String(length=255), nullable=False),
        sa.Column("demand_quantity", sa.Numeric(20, 6), nullable=False),
        sa.Column("unit", sa.String(length=64), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("demand_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_procurement_demands_source"),
    )
    op.create_index("ix_procurement_demands_enterprise_id", "procurement_demands", ["enterprise_id"], unique=False)
    op.create_index("ix_procurement_demands_material_id", "procurement_demands", ["material_id"], unique=False)

    op.create_table(
        "supplier_quotes",
        sa.Column("supplier_id", sa.String(length=64), nullable=False),
        sa.Column("supplier_name", sa.String(length=255), nullable=False),
        sa.Column("material_id", sa.String(length=64), nullable=False),
        sa.Column("material_name", sa.String(length=255), nullable=False),
        sa.Column("tier_id", sa.String(length=64), nullable=False),
        sa.Column("minimum_kg", sa.Numeric(20, 6), nullable=False),
        sa.Column("capacity_kg", sa.Numeric(20, 6), nullable=True),
        sa.Column("unit_price", sa.Numeric(20, 6), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=True),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("supplier_id", "material_id", "tier_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_supplier_quotes_source"),
    )

    op.create_table(
        "policies",
        sa.Column("policy_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=128), nullable=False),
        sa.Column("publisher", sa.String(length=255), nullable=True),
        sa.Column("region", sa.String(length=128), nullable=True),
        sa.Column("industry", sa.String(length=128), nullable=True),
        sa.Column("published_date", sa.Date(), nullable=True),
        sa.Column("effective_date", sa.Date(), nullable=True),
        sa.Column("expiration_date", sa.Date(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("conditions", sa.Text(), nullable=True),
        sa.Column("source_url", sa.String(length=1000), nullable=False),
        sa.Column("attachment_path", sa.String(length=1000), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("policy_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_policies_source"),
    )


def downgrade() -> None:
    op.drop_table("policies")
    op.drop_table("supplier_quotes")
    op.drop_index("ix_procurement_demands_material_id", table_name="procurement_demands")
    op.drop_index("ix_procurement_demands_enterprise_id", table_name="procurement_demands")
    op.drop_table("procurement_demands")
    op.drop_index("ix_preorders_required_at", table_name="preorders")
    op.drop_index("ix_preorders_product_id", table_name="preorders")
    op.drop_index("ix_preorders_store_id", table_name="preorders")
    op.drop_index("ix_preorders_partner_id", table_name="preorders")
    op.drop_table("preorders")
