"""Add default configuration pointers and AI execution traces."""

from alembic import op
import sqlalchemy as sa

revision = "20261003_0005"
down_revision = "20261003_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "configuration_defaults",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("config_type", sa.String(length=30), nullable=False),
        sa.Column("config_key", sa.String(length=80), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("config_type", "config_key", name="uq_configuration_default_key"),
    )
    op.create_table(
        "ai_traces",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("thread_id", sa.String(length=80), nullable=True),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("query", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("is_test", sa.Boolean(), nullable=False),
        sa.Column("route", sa.String(length=40), nullable=True),
        sa.Column("model_name", sa.String(length=80), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("configuration_version", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_traces_thread_id", "ai_traces", ["thread_id"], unique=False)
    op.create_index("ix_ai_traces_user_id", "ai_traces", ["user_id"], unique=False)
    op.create_index("ix_ai_traces_status", "ai_traces", ["status"], unique=False)
    op.create_index("ix_ai_traces_is_test", "ai_traces", ["is_test"], unique=False)
    op.create_table(
        "ai_trace_spans",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("trace_id", sa.String(length=36), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("model_name", sa.String(length=80), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["trace_id"], ["ai_traces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_trace_spans_trace_id", "ai_trace_spans", ["trace_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ai_trace_spans_trace_id", table_name="ai_trace_spans")
    op.drop_table("ai_trace_spans")
    op.drop_index("ix_ai_traces_is_test", table_name="ai_traces")
    op.drop_index("ix_ai_traces_status", table_name="ai_traces")
    op.drop_index("ix_ai_traces_user_id", table_name="ai_traces")
    op.drop_index("ix_ai_traces_thread_id", table_name="ai_traces")
    op.drop_table("ai_traces")
    op.drop_table("configuration_defaults")
