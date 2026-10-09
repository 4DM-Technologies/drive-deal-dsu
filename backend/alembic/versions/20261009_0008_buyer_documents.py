"""Buyer personal-details documents (driving licence uploaded at signup).

Revision ID: 20261009_0008
Revises: 20261006_0007
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261009_0008"
down_revision: str | None = "20261006_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_exists(table: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table in inspector.get_table_names()


def upgrade() -> None:
    # The application also creates missing tables at startup, so this stays idempotent for databases
    # that already picked the table up that way.
    if _table_exists("buyer_documents"):
        return
    op.create_table(
        "buyer_documents",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("profile_id", sa.String(length=36), nullable=False),
        sa.Column("document_type", sa.String(length=40), nullable=False),
        sa.Column("object_key", sa.String(length=1024), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("profile_id", "document_type", name="uq_buyer_documents_profile_type"),
    )
    op.create_index(op.f("ix_buyer_documents_profile_id"), "buyer_documents", ["profile_id"], unique=False)


def downgrade() -> None:
    if _table_exists("buyer_documents"):
        op.drop_index(op.f("ix_buyer_documents_profile_id"), table_name="buyer_documents")
        op.drop_table("buyer_documents")
