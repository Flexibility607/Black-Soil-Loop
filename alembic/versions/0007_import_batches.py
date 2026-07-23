"""create import batch table

Revision ID: 0007_import_batches
Revises: 0006_planning_records
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007_import_batches"
down_revision: Union[str, Sequence[str], None] = "0006_planning_records"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "import_batches",
        sa.Column("batch_id", sa.String(length=64), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("uploaded_by", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rows_json", sa.JSON(), nullable=False),
        sa.Column("summary_json", sa.JSON(), nullable=False),
        sa.Column("errors_json", sa.JSON(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("batch_id"),
    )
    op.create_index("ix_import_batches_uploaded_by", "import_batches", ["uploaded_by"], unique=False)
    op.create_index("ix_import_batches_status", "import_batches", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_import_batches_status", table_name="import_batches")
    op.drop_index("ix_import_batches_uploaded_by", table_name="import_batches")
    op.drop_table("import_batches")
