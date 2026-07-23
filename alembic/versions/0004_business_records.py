"""create B01 inventory, sales and return tables

Revision ID: 0004_business_records
Revises: 0003_production
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_business_records"
down_revision: Union[str, Sequence[str], None] = "0003_production"
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
        "inventories",
        sa.Column("inventory_record_id", sa.String(length=64), nullable=False),
        sa.Column("enterprise_id", sa.String(length=64), nullable=False),
        sa.Column("warehouse_id", sa.String(length=64), nullable=False),
        sa.Column("warehouse_name", sa.String(length=255), nullable=True),
        sa.Column("product_id", sa.String(length=64), nullable=False),
        sa.Column("product_name", sa.String(length=255), nullable=False),
        sa.Column("category_id", sa.String(length=128), nullable=False),
        sa.Column("specification", sa.String(length=255), nullable=True),
        sa.Column("unit", sa.String(length=64), nullable=False),
        sa.Column("supplier_id", sa.String(length=64), nullable=True),
        sa.Column("supplier_name", sa.String(length=255), nullable=True),
        sa.Column("batch_id", sa.String(length=128), nullable=True),
        sa.Column("current_qty", sa.Numeric(20, 6), nullable=False),
        sa.Column("inbound_qty", sa.Numeric(20, 6), nullable=True),
        sa.Column("outbound_qty", sa.Numeric(20, 6), nullable=True),
        sa.Column("adjustment_qty", sa.Numeric(20, 6), nullable=True),
        sa.Column("count_book_qty", sa.Numeric(20, 6), nullable=True),
        sa.Column("count_actual_qty", sa.Numeric(20, 6), nullable=True),
        sa.Column("production_date", sa.Date(), nullable=True),
        sa.Column("expiration_date", sa.Date(), nullable=True),
        sa.Column("stock_lower", sa.Numeric(20, 6), nullable=True),
        sa.Column("stock_upper", sa.Numeric(20, 6), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("inventory_record_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_inventories_source"),
    )
    op.create_index("ix_inventories_enterprise_id", "inventories", ["enterprise_id"], unique=False)
    op.create_index("ix_inventories_warehouse_id", "inventories", ["warehouse_id"], unique=False)
    op.create_index("ix_inventories_product_id", "inventories", ["product_id"], unique=False)
    op.create_index("ix_inventories_recorded_at", "inventories", ["recorded_at"], unique=False)

    op.create_table(
        "sales_order_lines",
        sa.Column("sales_order_id", sa.String(length=64), nullable=False),
        sa.Column("line_no", sa.Integer(), nullable=False),
        sa.Column("enterprise_id", sa.String(length=64), nullable=False),
        sa.Column("customer_id", sa.String(length=64), nullable=True),
        sa.Column("customer_name", sa.String(length=255), nullable=True),
        sa.Column("customer_phone", sa.String(length=64), nullable=True),
        sa.Column("customer_address", sa.String(length=500), nullable=True),
        sa.Column("ordered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("delivery_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("product_id", sa.String(length=64), nullable=False),
        sa.Column("product_name", sa.String(length=255), nullable=False),
        sa.Column("quantity", sa.Numeric(20, 6), nullable=False),
        sa.Column("unit", sa.String(length=64), nullable=False),
        sa.Column("order_amount", sa.Numeric(20, 6), nullable=True),
        sa.Column("discount_amount", sa.Numeric(20, 6), nullable=True),
        sa.Column("received_amount", sa.Numeric(20, 6), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("payment_status", sa.String(length=32), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("sales_order_id", "line_no"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_sales_order_lines_source"),
    )
    op.create_index("ix_sales_order_lines_enterprise_id", "sales_order_lines", ["enterprise_id"], unique=False)
    op.create_index("ix_sales_order_lines_ordered_at", "sales_order_lines", ["ordered_at"], unique=False)
    op.create_index("ix_sales_order_lines_product_id", "sales_order_lines", ["product_id"], unique=False)

    op.create_table(
        "returns",
        sa.Column("return_id", sa.String(length=64), nullable=False),
        sa.Column("sales_order_id", sa.String(length=64), nullable=False),
        sa.Column("line_no", sa.Integer(), nullable=True),
        sa.Column("enterprise_id", sa.String(length=64), nullable=False),
        sa.Column("product_id", sa.String(length=64), nullable=False),
        sa.Column("product_name", sa.String(length=255), nullable=False),
        sa.Column("quantity", sa.Numeric(20, 6), nullable=False),
        sa.Column("unit", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("amount", sa.Numeric(20, 6), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("return_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_returns_source"),
    )
    op.create_index("ix_returns_sales_order_id", "returns", ["sales_order_id"], unique=False)
    op.create_index("ix_returns_enterprise_id", "returns", ["enterprise_id"], unique=False)
    op.create_index("ix_returns_product_id", "returns", ["product_id"], unique=False)
    op.create_index("ix_returns_returned_at", "returns", ["returned_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_returns_returned_at", table_name="returns")
    op.drop_index("ix_returns_product_id", table_name="returns")
    op.drop_index("ix_returns_enterprise_id", table_name="returns")
    op.drop_index("ix_returns_sales_order_id", table_name="returns")
    op.drop_table("returns")
    op.drop_index("ix_sales_order_lines_product_id", table_name="sales_order_lines")
    op.drop_index("ix_sales_order_lines_ordered_at", table_name="sales_order_lines")
    op.drop_index("ix_sales_order_lines_enterprise_id", table_name="sales_order_lines")
    op.drop_table("sales_order_lines")
    op.drop_index("ix_inventories_recorded_at", table_name="inventories")
    op.drop_index("ix_inventories_product_id", table_name="inventories")
    op.drop_index("ix_inventories_warehouse_id", table_name="inventories")
    op.drop_index("ix_inventories_enterprise_id", table_name="inventories")
    op.drop_table("inventories")
