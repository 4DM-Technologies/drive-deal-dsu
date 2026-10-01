"""Reuses the backend's existing 'Sign in with ChatGPT' OAuth credential so this POC
doesn't need its own OPENAI_API_KEY. Mirrors backend/src/agents/llm.py's call shape
(Responses API, streaming, store=False) since that backend is gated behind the same
quirks (plain create() 400s on this credential).

For this standalone test script only — the real app should keep using src/agents/llm.py.
"""

import json
import sys
from pathlib import Path

BACKEND_SRC = Path(__file__).resolve().parents[2] / "backend"
if str(BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(BACKEND_SRC))

from openai import AsyncOpenAI  # noqa: E402

from src.auth.codex_oauth import get_cached_access_token  # noqa: E402
from src.settings import get_settings  # noqa: E402


async def _resolve_client() -> AsyncOpenAI:
    settings = get_settings()
    credential = settings.openai_api_key or settings.codex_oauth_access_token or await get_cached_access_token()
    if not credential:
        raise RuntimeError("No OpenAI credential available (checked OPENAI_API_KEY, codex oauth env/cache)")
    return AsyncOpenAI(api_key=credential, timeout=settings.ai_request_timeout_seconds)


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
    return text.strip()


async def complete_json(system_prompt: str, user_prompt: str) -> dict:
    """Asks the model for a JSON object and parses it. No response_format/json_schema param
    is used since the chatgpt-oauth-gated model doesn't reliably support it (see llm.py)."""
    settings = get_settings()
    client = await _resolve_client()

    full_prompt = f"{system_prompt}\n\nRespond with ONLY a single valid JSON object, no markdown fences, no commentary.\n\n{user_prompt}"

    kwargs = {
        "model": settings.openai_model,
        "input": [{"role": "user", "content": full_prompt}],
        "store": False,
        "stream": True,
    }

    for _attempt in range(3):
        try:
            stream = await client.responses.create(**kwargs)
            text = ""
            async for event in stream:
                if getattr(event, "type", "") == "response.output_text.delta":
                    text += event.delta
            return json.loads(_strip_code_fence(text))
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
