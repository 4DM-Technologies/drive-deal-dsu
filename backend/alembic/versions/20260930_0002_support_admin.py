"""Add the support-admin operations role."""

from alembic import op

revision = "20260930_0002"
down_revision = "20260930_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_profiles_role", "profiles", type_="check")
    op.create_check_constraint(
        "ck_profiles_role",
        "profiles",
        "role IN ('buyer','dealer','support','support-admin','admin')",
    )


def downgrade() -> None:
    op.execute("UPDATE profiles SET role = 'support' WHERE role = 'support-admin'")
    op.drop_constraint("ck_profiles_role", "profiles", type_="check")
    op.create_check_constraint(
        "ck_profiles_role",
        "profiles",
        "role IN ('buyer','dealer','support','admin')",
    )
