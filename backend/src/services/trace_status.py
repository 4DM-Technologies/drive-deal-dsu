from collections.abc import Iterable, Mapping
from typing import Any

# The provider was called and refused or errored (rate limit, auth, outage); the reply came from a canned fallback.
# Plain "fallback" is different: no provider is configured at all (offline development and tests), not an error.
FAILED_LLM_STATUSES = frozenset({"provider_fallback"})
MAX_ERROR_CHARS = 2000


def llm_failure(spans: Iterable[Mapping[str, Any]]) -> str | None:
    """The first LLM error in a trace's spans, as ``"<step>: <provider error>"``, or ``None`` when every call worked.

    A trace whose model call failed is not a success even though a fallback reply was still sent, so callers
    mark it failed and keep this message on the trace.
    """
    for span in spans:
        if span.get("kind") == "llm" and span.get("status") in FAILED_LLM_STATUSES:
            details = span.get("details") or {}
            error = str(details.get("error") or "The AI provider did not return a response.")
            return f"{span.get('name') or 'llm'}: {error}"[:MAX_ERROR_CHARS]
    return None
