"""Track unique dealer views of buyer requests.

Revision ID: 20261004_0006
Revises: 20261003_0005
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261004_0006"
down_revision: str | None = "20261003_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "buyer_request_views",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("buyer_request_id", sa.String(length=36), nullable=False),
        sa.Column("dealer_id", sa.String(length=36), nullable=False),
        sa.Column("first_viewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_viewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["buyer_request_id"], ["buyer_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["dealer_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("buyer_request_id", "dealer_id", name="uq_request_view_dealer"),
    )
    op.create_index(
        op.f("ix_buyer_request_views_buyer_request_id"), "buyer_request_views", ["buyer_request_id"], unique=False
    )
    op.create_index(op.f("ix_buyer_request_views_dealer_id"), "buyer_request_views", ["dealer_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_buyer_request_views_dealer_id"), table_name="buyer_request_views")
    op.drop_index(op.f("ix_buyer_request_views_buyer_request_id"), table_name="buyer_request_views")
    op.drop_table("buyer_request_views")
