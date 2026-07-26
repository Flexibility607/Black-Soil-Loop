"""add single-device session version

Revision ID: 0009_single_device_sessions
Revises: 0008_leadership_feedback
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009_single_device_sessions"
down_revision: Union[str, Sequence[str], None] = "0008_leadership_feedback"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("session_version", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("users", "session_version")
