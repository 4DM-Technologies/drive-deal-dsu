"""Dealer application documents (Motor Vehicle Dealer License uploaded at signup).

The files live in private storage under dealer/<dealer id>/personal-details/dealer-documents/;
this table records each one's key and descriptive metadata.

Revision ID: 20261013_0011
Revises: 20261013_0010
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261013_0011"
down_revision: str | None = "20261013_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "dealer_documents"


def _table_exists() -> bool:
    return TABLE in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # The application also creates missing tables at startup, so this stays idempotent for databases
    # that already picked the table up that way.
    if _table_exists():
        return
    op.create_table(
        TABLE,
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
        sa.UniqueConstraint("profile_id", "document_type", name="uq_dealer_documents_profile_type"),
    )
    op.create_index(op.f("ix_dealer_documents_profile_id"), TABLE, ["profile_id"], unique=False)


def downgrade() -> None:
    if _table_exists():
        op.drop_index(op.f("ix_dealer_documents_profile_id"), table_name=TABLE)
        op.drop_table(TABLE)
