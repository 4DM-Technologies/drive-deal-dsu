"""Add versioned administrator configuration and audit history."""

from alembic import op
import sqlalchemy as sa

revision = "20261003_0004"
down_revision = "20260930_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "configuration_revisions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("config_type", sa.String(length=30), nullable=False),
        sa.Column("config_key", sa.String(length=80), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("checksum", sa.String(length=64), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_by", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
        sa.CheckConstraint("status IN ('draft','published','archived')", name="ck_configuration_revision_status"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("config_type", "config_key", "version", name="uq_configuration_revision_version"),
    )
    op.create_index(
        "ix_configuration_revision_active",
        "configuration_revisions",
        ["config_type", "config_key", "status"],
        unique=False,
    )
    op.create_index(
        "uq_configuration_revision_published",
        "configuration_revisions",
        ["config_type", "config_key"],
        unique=True,
        postgresql_where=sa.text("status = 'published'"),
        sqlite_where=sa.text("status = 'published'"),
    )
    op.create_table(
        "administration_audit_events",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("resource_type", sa.String(length=30), nullable=False),
        sa.Column("resource_key", sa.String(length=80), nullable=False),
        sa.Column("revision_id", sa.String(length=36), nullable=True),
        sa.Column("actor_id", sa.String(length=64), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    op.create_index("ix_administration_audit_events_action", "administration_audit_events", ["action"], unique=False)
    op.create_index("ix_administration_audit_events_actor_id", "administration_audit_events", ["actor_id"], unique=False)
    op.create_index("ix_administration_audit_events_created_at", "administration_audit_events", ["created_at"], unique=False)
    op.create_index("ix_administration_audit_events_resource_key", "administration_audit_events", ["resource_key"], unique=False)
    op.create_index("ix_administration_audit_events_resource_type", "administration_audit_events", ["resource_type"], unique=False)
    op.create_index("ix_administration_audit_events_revision_id", "administration_audit_events", ["revision_id"], unique=False)


def downgrade() -> None:
    op.drop_table("administration_audit_events")
    op.drop_index("uq_configuration_revision_published", table_name="configuration_revisions")
    op.drop_index("ix_configuration_revision_active", table_name="configuration_revisions")
    op.drop_table("configuration_revisions")
