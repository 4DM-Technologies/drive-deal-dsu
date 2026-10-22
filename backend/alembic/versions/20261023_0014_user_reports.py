"""Misconduct reports a buyer or dealer files about the other person in a conversation, and their screenshots.

Screenshots live in private storage under reports/<buyer|dealer>/<reported profile id>/<report reference>/; the
attachments table records each one's key and descriptive metadata.

Revision ID: 20261023_0014
Revises: 20261022_0013
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261023_0014"
down_revision: str | None = "20261022_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REPORTS = "user_reports"
ATTACHMENTS = "user_report_attachments"


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _audit_columns() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
    ]


def upgrade() -> None:
    # The application also creates missing tables at startup, so each create is skipped when the table exists.
    existing = _tables()
    if REPORTS not in existing:
        op.create_table(
            REPORTS,
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("report_id", sa.String(length=40), nullable=False),
            sa.Column("quote_id", sa.String(length=36), nullable=False),
            sa.Column("reporter_id", sa.String(length=36), nullable=False),
            sa.Column("reporter_role", sa.String(length=20), nullable=False),
            sa.Column("reported_id", sa.String(length=36), nullable=False),
            sa.Column("reported_role", sa.String(length=20), nullable=False),
            sa.Column("reason", sa.String(length=40), nullable=False),
            sa.Column("details", sa.Text(), nullable=False),
            sa.Column("conversation_snapshot", sa.JSON(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("outcome", sa.String(length=30), nullable=True),
            sa.Column("notes", sa.JSON(), nullable=False),
            *_audit_columns(),
            sa.CheckConstraint(
                "status IN ('open','under_review','action_taken','dismissed')", name="ck_user_reports_status"
            ),
            sa.CheckConstraint(
                "outcome IS NULL OR outcome IN ('no_violation','warning_issued','account_suspended','other')",
                name="ck_user_reports_outcome",
            ),
            sa.ForeignKeyConstraint(["quote_id"], ["deal_quotes.id"]),
            sa.ForeignKeyConstraint(["reporter_id"], ["profiles.id"]),
            sa.ForeignKeyConstraint(["reported_id"], ["profiles.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("report_id"),
        )
        for column in ("quote_id", "reporter_id", "reported_id", "status"):
            op.create_index(op.f(f"ix_{REPORTS}_{column}"), REPORTS, [column], unique=False)
    if ATTACHMENTS not in existing:
        op.create_table(
            ATTACHMENTS,
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("report_id", sa.String(length=36), nullable=False),
            sa.Column("object_key", sa.String(length=1024), nullable=False),
            sa.Column("file_name", sa.String(length=255), nullable=False),
            sa.Column("content_type", sa.String(length=100), nullable=False),
            sa.Column("size_bytes", sa.Integer(), nullable=False),
            *_audit_columns(),
            sa.ForeignKeyConstraint(["report_id"], [f"{REPORTS}.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f(f"ix_{ATTACHMENTS}_report_id"), ATTACHMENTS, ["report_id"], unique=False)


def downgrade() -> None:
    existing = _tables()
    if ATTACHMENTS in existing:
        op.drop_index(op.f(f"ix_{ATTACHMENTS}_report_id"), table_name=ATTACHMENTS)
        op.drop_table(ATTACHMENTS)
    if REPORTS in existing:
        for column in ("quote_id", "reporter_id", "reported_id", "status"):
            op.drop_index(op.f(f"ix_{REPORTS}_{column}"), table_name=REPORTS)
        op.drop_table(REPORTS)
