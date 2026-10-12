"""Help & support: screenshots or PDFs attached to a ticket.

The files live in private storage under help-support/<buyer-support|dealer-support>/<profile id>/<ticket id>/;
this table records each one's key and descriptive metadata.

Revision ID: 20261013_0010
Revises: 20261012_0009
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261013_0010"
down_revision: str | None = "20261012_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "support_ticket_attachments"


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
        sa.Column("ticket_id", sa.String(length=36), nullable=False),
        sa.Column("object_key", sa.String(length=1024), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["ticket_id"], ["support_tickets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_support_ticket_attachments_ticket_id", TABLE, ["ticket_id"])


def downgrade() -> None:
    if _table_exists():
        op.drop_index("ix_support_ticket_attachments_ticket_id", table_name=TABLE)
        op.drop_table(TABLE)
