"""Add structured issue context to support tickets."""

from sqlalchemy import Column, String, Text

from alembic import op

revision = "20260930_0003"
down_revision = "20260930_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("support_tickets", Column("issue_description", Text(), nullable=True))
    op.add_column("support_tickets", Column("issue_type", String(length=40), server_default="bug", nullable=False))
    op.add_column("support_tickets", Column("page_context", String(length=500), nullable=True))
    op.add_column("support_tickets", Column("issue_image_url", String(length=2048), nullable=True))
    op.alter_column("support_tickets", "issue_type", server_default=None)


def downgrade() -> None:
    op.drop_column("support_tickets", "issue_image_url")
    op.drop_column("support_tickets", "page_context")
    op.drop_column("support_tickets", "issue_type")
    op.drop_column("support_tickets", "issue_description")
