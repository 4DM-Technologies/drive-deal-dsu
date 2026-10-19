import asyncio
from time import perf_counter
from uuid import uuid4

from src.database import SessionFactory
from src.repositories.schema import AiTrace, AiTraceSpan
from src.services.ai_service import AiService
from src.services.trace_status import llm_failure

RATE_LIMIT = "Error code: 429 - {'error': {'type': 'usage_limit_reached'}}"


def span(name: str, status: str, kind: str = "llm", error: str | None = None) -> dict:
    return {"name": name, "kind": kind, "status": status, "details": {"error": error} if error else {}}


def test_a_provider_error_is_a_failure_with_its_message() -> None:
    spans = [span("triage", "success", kind="router"), span("classifier", "provider_fallback", error=RATE_LIMIT)]
    assert llm_failure(spans) == f"classifier: {RATE_LIMIT}"


def test_successful_calls_and_offline_fallbacks_are_not_failures() -> None:
    # "fallback" means no provider is configured (offline development), not that a model call errored.
    assert llm_failure([span("classifier", "success"), span("compose", "fallback")]) is None
    assert llm_failure([]) is None


def test_a_failure_without_error_text_still_explains_itself() -> None:
    assert llm_failure([span("compose", "provider_fallback")]) == (
        "compose: The AI provider did not return a response."
    )


def finished_trace(span_status: str) -> AiTrace:
    async def _run() -> AiTrace:
        async with SessionFactory() as session:
            trace = AiTrace(id=str(uuid4()), thread_id=f"thread-{uuid4().hex[:8]}", query="tesla?", status="running")
            session.add(trace)
            await session.flush()
            session.add(
                AiTraceSpan(
                    trace_id=trace.id,
                    sequence=1,
                    name="classifier",
                    kind="llm",
                    status=span_status,
                    details={"error": RATE_LIMIT} if span_status == "provider_fallback" else {},
                )
            )
            await session.flush()
            await AiService(session)._finish_trace(trace, {"route": "compare"}, perf_counter())
            await session.rollback()
            return trace

    return asyncio.run(_run())


def test_finishing_a_trace_whose_model_call_errored_marks_it_failed() -> None:
    trace = finished_trace("provider_fallback")
    assert trace.status == "failed"
    assert trace.error_message == f"classifier: {RATE_LIMIT}"


def test_finishing_a_trace_whose_model_calls_worked_marks_it_successful() -> None:
    trace = finished_trace("success")
    assert trace.status == "success"
    assert trace.error_message is None
