"""create B01 master data tables

Revision ID: 0002_master_data
Revises: 0001_auth_tables
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_master_data"
down_revision: Union[str, Sequence[str], None] = "0001_auth_tables"
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
        "parks",
        sa.Column("park_id", sa.String(length=64), nullable=False),
        sa.Column("park_name", sa.String(length=255), nullable=False),
        sa.Column("address", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("park_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_parks_source"),
    )
    op.create_table(
        "enterprises",
        sa.Column("enterprise_id", sa.String(length=64), nullable=False),
        sa.Column("park_id", sa.String(length=64), nullable=False),
        sa.Column("enterprise_name", sa.String(length=255), nullable=False),
        sa.Column("industry", sa.String(length=128), nullable=False),
        sa.Column("enterprise_contact_name", sa.String(length=128), nullable=True),
        sa.Column("enterprise_phone", sa.String(length=64), nullable=True),
        sa.Column("enterprise_address", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("enterprise_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_enterprises_source"),
    )
    op.create_index("ix_enterprises_park_id", "enterprises", ["park_id"], unique=False)
    op.create_table(
        "enterprise_tags",
        sa.Column("enterprise_id", sa.String(length=64), nullable=False),
        sa.Column("tag", sa.String(length=128), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("enterprise_id", "tag"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_enterprise_tags_source"),
    )
    op.create_table(
        "partners",
        sa.Column("partner_id", sa.String(length=64), nullable=False),
        sa.Column("partner_name", sa.String(length=255), nullable=False),
        sa.Column("partner_type", sa.String(length=128), nullable=False),
        sa.Column("partner_contact_name", sa.String(length=128), nullable=False),
        sa.Column("partner_phone", sa.String(length=64), nullable=False),
        sa.Column("partner_address", sa.String(length=500), nullable=False),
        sa.Column("relationship_status", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("partner_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_partners_source"),
    )
    op.create_table(
        "stores",
        sa.Column("store_id", sa.String(length=64), nullable=False),
        sa.Column("partner_id", sa.String(length=64), nullable=False),
        sa.Column("store_name", sa.String(length=255), nullable=False),
        sa.Column("store_contact_name", sa.String(length=128), nullable=False),
        sa.Column("store_phone", sa.String(length=64), nullable=False),
        sa.Column("delivery_address", sa.String(length=500), nullable=False),
        sa.Column("longitude", sa.Numeric(10, 7), nullable=True),
        sa.Column("latitude", sa.Numeric(10, 7), nullable=True),
        sa.Column("relationship_status", sa.String(length=32), nullable=False),
        *tracked_columns(),
        sa.PrimaryKeyConstraint("store_id"),
        sa.UniqueConstraint("source_system", "source_record_id", name="uq_stores_source"),
    )
    op.create_index("ix_stores_partner_id", "stores", ["partner_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_stores_partner_id", table_name="stores")
    op.drop_table("stores")
    op.drop_table("partners")
    op.drop_table("enterprise_tags")
    op.drop_index("ix_enterprises_park_id", table_name="enterprises")
    op.drop_table("enterprises")
    op.drop_table("parks")

