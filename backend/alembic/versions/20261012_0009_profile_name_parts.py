"""Profiles: first and last name for buyers.

Buyers now sign up with a first and a last name; ``full_name`` stays the display name and is built from them.
Buyers who signed up before this keep their whole name in ``first_name`` with no last name.

Revision ID: 20261012_0009
Revises: 20261009_0008b
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261012_0009"
down_revision: str | None = "20261009_0008b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _profile_columns() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns("profiles")}


def upgrade() -> None:
    # Idempotent, so it is safe on a database where the columns were already added by hand.
    existing = _profile_columns()
    if "first_name" not in existing:
        op.add_column("profiles", sa.Column("first_name", sa.String(length=80), nullable=True))
    if "last_name" not in existing:
        op.add_column("profiles", sa.Column("last_name", sa.String(length=80), nullable=True))
    op.execute("UPDATE profiles SET first_name = SUBSTR(full_name, 1, 80) WHERE role = 'buyer' AND first_name IS NULL")


def downgrade() -> None:
    existing = _profile_columns()
    if "last_name" in existing:
        op.drop_column("profiles", "last_name")
    if "first_name" in existing:
        op.drop_column("profiles", "first_name")
