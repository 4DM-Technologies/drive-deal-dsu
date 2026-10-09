"""Reuses the backend's existing 'Sign in with ChatGPT' OAuth credential (same as
testing/car-scraper-poc/llm_client.py) so this POC doesn't need its own OPENAI_API_KEY.
Extended to return token usage + latency alongside the parsed JSON, since "how many
tokens did extraction cost" is one of the things this POC exists to measure.

For this standalone test script only - the real app keeps using src/agents/llm.py.
"""

import json
import sys
import time
from pathlib import Path

from models import TokenUsage

BACKEND_SRC = Path(__file__).resolve().parents[2] / "backend"
if str(BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(BACKEND_SRC))

from openai import AsyncOpenAI  # noqa: E402

from src.auth.codex_oauth import get_cached_access_token  # noqa: E402
from src.settings import CODEX_DIRECT_BASE_URL, CODEX_DIRECT_USER_AGENT, get_settings  # noqa: E402


async def _resolve_client() -> AsyncOpenAI:
    settings = get_settings()
    if settings.openai_api_key:
        return AsyncOpenAI(api_key=settings.openai_api_key, timeout=settings.ai_request_timeout_seconds)

    credential = settings.codex_oauth_access_token or await get_cached_access_token()
    if not credential:
        raise RuntimeError("No OpenAI credential available (checked OPENAI_API_KEY, codex oauth env/cache)")
    # A ChatGPT-OAuth-sourced credential is only valid against ChatGPT's own backend, not the
    # public OpenAI API (which gates /v1/responses behind the api.responses.write platform scope
    # this token was never granted - see src/agents/llm.py's _resolve_client for the same routing).
    return AsyncOpenAI(
        api_key=credential,
        base_url=CODEX_DIRECT_BASE_URL,
        default_headers={"User-Agent": CODEX_DIRECT_USER_AGENT},
        timeout=settings.ai_request_timeout_seconds,
    )


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
    return text.strip()


async def complete_json(system_prompt: str, user_prompt: str) -> tuple[dict, TokenUsage, float]:
    """Returns (parsed_json, token_usage, duration_ms). No response_format/json_schema param
    is used since the chatgpt-oauth-gated model doesn't reliably support it (see llm.py)."""
    settings = get_settings()
    client = await _resolve_client()

    full_prompt = (
        f"{system_prompt}\n\nRespond with ONLY a single valid JSON object, "
        f"no markdown fences, no commentary.\n\n{user_prompt}"
    )

    kwargs = {
        "model": "gpt-6-luna",
        "input": [{"role": "user", "content": full_prompt}],
        "store": False,
        "stream": True,
    }

    start = time.perf_counter()
    for _attempt in range(3):
        try:
            stream = await client.responses.create(**kwargs)
            text = ""
            usage = TokenUsage()
            async for event in stream:
                event_type = getattr(event, "type", "")
                if event_type == "response.output_text.delta":
                    text += event.delta
                elif event_type == "response.completed":
                    raw_usage = getattr(event.response, "usage", None)
                    if raw_usage:
                        usage = TokenUsage(
                            input_tokens=getattr(raw_usage, "input_tokens", 0) or 0,
                            output_tokens=getattr(raw_usage, "output_tokens", 0) or 0,
                            total_tokens=getattr(raw_usage, "total_tokens", 0) or 0,
                        )
            duration_ms = (time.perf_counter() - start) * 1000
            return json.loads(_strip_code_fence(text)), usage, duration_ms
        except Exception as exc:  # noqa: BLE001
            detail = str(exc).lower()
            if "max_output_tokens" in detail and "max_output_tokens" in kwargs:
                kwargs.pop("max_output_tokens", None)
                continue
            if "reasoning" in detail and "reasoning" in kwargs:
                kwargs.pop("reasoning", None)
                continue
            raise
    raise RuntimeError("LLM call failed after retries")
