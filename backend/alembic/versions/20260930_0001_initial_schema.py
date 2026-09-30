"""Create the complete DriveDeal schema."""

from alembic import op
from src.database import Base
from src.repositories.schema import tables  # noqa: F401

revision = "20260930_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
