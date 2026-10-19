"""Mark past AI traces whose model call errored as failed.

Traces used to be recorded as "success" even when the AI provider refused a call (for example a 429 usage limit)
and the buyer was sent a canned fallback reply. New traces are now marked "failed"; this applies the same rule to
traces recorded before the fix, using the failed LLM spans each trace already stores.

Revision ID: 20261019_0012
Revises: 20261013_0011
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261019_0012"
down_revision: str | None = "20261013_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Mirrors src/services/trace_status.py. Kept local so this migration never changes when app code does.
FAILED_LLM_STATUS = "provider_fallback"
MAX_ERROR_CHARS = 2000

traces = sa.table(
    "ai_traces",
    sa.column("id", sa.String),
    sa.column("status", sa.String),
    sa.column("error_message", sa.Text),
)
spans = sa.table(
    "ai_trace_spans",
    sa.column("trace_id", sa.String),
    sa.column("sequence", sa.Integer),
    sa.column("name", sa.String),
    sa.column("kind", sa.String),
    sa.column("status", sa.String),
    sa.column("details", sa.JSON),
)


def upgrade() -> None:
    bind = op.get_bind()
    failed_spans = bind.execute(
        sa.select(spans.c.trace_id, spans.c.name, spans.c.details)
        .select_from(spans.join(traces, traces.c.id == spans.c.trace_id))
        .where(spans.c.kind == "llm", spans.c.status == FAILED_LLM_STATUS, traces.c.status == "success")
        .order_by(spans.c.trace_id, spans.c.sequence)
    ).all()
    # The first failed call in each trace explains it, exactly as new traces record it.
    messages: dict[str, str] = {}
    for trace_id, name, details in failed_spans:
        if trace_id in messages:
            continue
        error = (details or {}).get("error") if isinstance(details, dict) else None
        messages[trace_id] = f"{name or 'llm'}: {error or 'The AI provider did not return a response.'}"[
            :MAX_ERROR_CHARS
        ]
    for trace_id, message in messages.items():
        bind.execute(
            sa.update(traces)
            .where(traces.c.id == trace_id, traces.c.status == "success")
            .values(status="failed", error_message=message)
        )


def downgrade() -> None:
    # Which traces were really successful cannot be recovered, and "failed" is the accurate record, so there is
    # nothing to undo.
    pass
