"""Premium subscription columns and payments ledger.

Revision ID: 20261006_0007
Revises: 20261004_0006
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261006_0007"
down_revision: str | None = "20261004_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PROFILE_COLUMNS = (
    sa.Column("trial_started_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("trial_expires_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("is_premium", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    sa.Column("premium_expires_at", sa.DateTime(timezone=True), nullable=True),
)


def _existing_columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(table)}


def _table_exists(table: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table in inspector.get_table_names()


def upgrade() -> None:
    # trial_started_at already exists on environments that were patched out-of-band, so every
    # profile column add is guarded to keep this migration idempotent across database generations.
    existing = _existing_columns("profiles")
    for column in PROFILE_COLUMNS:
        if column.name not in existing:
            op.add_column("profiles", column)
    if not _table_exists("payments"):
        op.create_table(
            "payments",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("profile_id", sa.String(length=36), nullable=False),
            sa.Column("plan", sa.String(length=30), nullable=False),
            sa.Column("amount", sa.Numeric(12, 2), nullable=False),
            sa.Column("currency", sa.String(length=3), nullable=False),
            sa.Column("payment_method", sa.String(length=20), nullable=False),
            sa.Column("card_brand", sa.String(length=20), nullable=True),
            sa.Column("card_last4", sa.String(length=4), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("premium_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", sa.String(length=64), nullable=False),
            sa.Column("updated_by", sa.String(length=64), nullable=False),
            sa.CheckConstraint("plan IN ('dealer_premium','buyer_premium')", name="ck_payments_plan"),
            sa.CheckConstraint("payment_method IN ('credit_card','debit_card')", name="ck_payments_method"),
            sa.CheckConstraint("status IN ('succeeded','failed','refunded')", name="ck_payments_status"),
            sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_payments_profile_id"), "payments", ["profile_id"], unique=False)


def downgrade() -> None:
    if _table_exists("payments"):
        op.drop_index(op.f("ix_payments_profile_id"), table_name="payments")
        op.drop_table("payments")
    existing = _existing_columns("profiles")
    for column in reversed(PROFILE_COLUMNS):
        if column.name in existing:
            op.drop_column("profiles", column.name)
