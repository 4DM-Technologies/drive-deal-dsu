"""Track when a buyer reminds dealers about an unquoted request and when they repush a closed one.

A request with no quotes after two weeks can be sent back to dealers once (dealers_notified_at). After a month with
no quotes it closes as "expired", and the buyer can repush it (repushed_at), which reopens it and restarts both clocks.

Revision ID: 20261022_0013
Revises: 20261019_0012
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261022_0013"
down_revision: str | None = "20261019_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "buyer_requests"
COLUMNS = ("dealers_notified_at", "repushed_at")


def _existing_columns() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(TABLE)}


def upgrade() -> None:
    existing = _existing_columns()
    for name in COLUMNS:
        if name not in existing:
            op.add_column(TABLE, sa.Column(name, sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    existing = _existing_columns()
    for name in COLUMNS:
        if name in existing:
            op.drop_column(TABLE, name)
