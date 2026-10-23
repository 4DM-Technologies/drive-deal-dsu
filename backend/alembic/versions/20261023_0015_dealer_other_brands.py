"""Brands a dealer typed under "Other" at signup or on their profile, for brands not in the catalog.

Catalog brands stay in profiles.supported_brands as brand ids; this keeps the typed names next to them, so the
brands table (which buyers pick from) never gains unreviewed entries.

Revision ID: 20261023_0015
Revises: 20261023_0014
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261023_0015"
down_revision: str | None = "20261023_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _columns() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns("profiles")}


def upgrade() -> None:
    if "other_brands" not in _columns():
        # Existing profiles get an empty list, so the column can be NOT NULL like supported_brands.
        op.add_column("profiles", sa.Column("other_brands", sa.JSON(), nullable=False, server_default=sa.text("'[]'")))


def downgrade() -> None:
    if "other_brands" in _columns():
        op.drop_column("profiles", "other_brands")
