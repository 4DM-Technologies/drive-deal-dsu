import json
import re
import threading
from dataclasses import dataclass
from time import perf_counter
from typing import Any

from openai import AsyncOpenAI, BadRequestError
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.codex_oauth import get_cached_access_token
from src.repositories.schema import AiTrace, AiTraceSpan, LlmAudit
from src.settings import CODEX_DIRECT_BASE_URL, CODEX_DIRECT_USER_AGENT, get_settings
from src.utils.log_flow import scrub_secrets
from src.utils.logger import logger

_capability_lock = threading.Lock()
_models_without_max_output_tokens: set[str] = set()
_models_without_reasoning_effort: set[str] = set()


def _safe_error_value(value: Any, *, limit: int = 320) -> str:
    """Redact tokens/keys/emails from provider error text before it goes anywhere (logs, audit rows)."""
    text = scrub_secrets(" ".join(str(value).split()), redact_email=True)
    return text[:limit]


def _safe_trace_value(value: Any, *, limit: int = 20_000) -> str:
    """Preserve prompt structure for administrators while removing credential-shaped values."""
    return scrub_secrets(str(value))[:limit]


@dataclass
class LlmResult:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    attempts: int = 1


class LlmClient:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.settings = get_settings()
        self._credential_source = "deterministic"

    async def _resolve_client(self) -> AsyncOpenAI | None:
        if self.settings.openai_api_key:
            self._credential_source = "api_key"
            credential = self.settings.openai_api_key
        elif self.settings.codex_oauth_access_token:
            self._credential_source = "chatgpt_oauth_env"
            credential = self.settings.codex_oauth_access_token
        else:
            credential = await get_cached_access_token()
            self._credential_source = "chatgpt_oauth_cache" if credential else "deterministic"
        if not credential:
            return None
        if self._credential_source == "api_key":
            return AsyncOpenAI(api_key=credential, timeout=self.settings.ai_request_timeout_seconds)
        # A ChatGPT-OAuth-sourced credential is only valid against ChatGPT's own backend, not the
        # public OpenAI API - different base URL, and Cloudflare blocks the SDK's default User-Agent.
        return AsyncOpenAI(
            api_key=credential,
            base_url=CODEX_DIRECT_BASE_URL,
            default_headers={"User-Agent": CODEX_DIRECT_USER_AGENT},
            timeout=self.settings.ai_request_timeout_seconds,
        )

    async def generate(
        self,
        prompt: str,
        task_type: str,
        thread_id: str | None = None,
        *,
        reasoning_effort: str | None = None,
        prompt_version: str = "v1",
        model: str | None = None,
        max_output_tokens: int | None = None,
    ) -> LlmResult:
        started = perf_counter()
        client = await self._resolve_client()
        status = "fallback"
        provider = "deterministic"
        model_name = "drivedeal-dev-fallback"
        error_message = None
        if client:
            provider = "openai" if self._credential_source == "api_key" else self._credential_source
            model_name = model or self.settings.openai_model
            try:
                result = await self._complete(client, prompt, reasoning_effort, model_name, max_output_tokens)
                status = "success"
            except Exception as exc:
                error_message = _safe_error_value(str(exc), limit=2000)
                logger.warning("llm_provider_fallback", task_type=task_type, provider=provider, error=error_message)
                result = LlmResult(self._fallback(prompt, task_type))
                status = "provider_fallback"
        else:
            result = LlmResult(self._fallback(prompt, task_type))
        elapsed = int((perf_counter() - started) * 1000)
        self.session.add(
            LlmAudit(
                task_type=task_type,
                provider=provider,
                model_name=model_name,
                thread_id=thread_id,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
                total_tokens=result.input_tokens + result.output_tokens,
                latency_ms=elapsed,
                status=status,
                prompt_version=prompt_version,
            )
        )
        if thread_id and await self.session.get(AiTrace, thread_id):
            self.session.add(
                AiTraceSpan(
                    trace_id=thread_id,
                    sequence=0,
                    name=task_type,
                    kind="llm",
                    status=status,
                    duration_ms=elapsed,
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                    model_name=model_name,
                    details={
                        "provider": provider,
                        "prompt_version": prompt_version,
                        "input": _safe_trace_value(prompt),
                        "output": _safe_trace_value(result.text),
                        "llm_called": True,
                        "reasoning_effort": reasoning_effort or self.settings.openai_reasoning_effort,
                        "max_output_tokens": max_output_tokens or self.settings.ai_max_output_tokens,
                        "attempt_count": result.attempts,
                        "error": error_message,
                    },
                )
            )
        await self.session.flush()
        logger.info(
            "agent_llm_call",
            thread_id=thread_id,
            task_type=task_type,
            provider=provider,
            model=model_name,
            status=status,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            latency_ms=elapsed,
            reasoning_effort=reasoning_effort or self.settings.openai_reasoning_effort,
            prompt_version=prompt_version,
            prompt_excerpt=_safe_error_value(prompt, limit=200),
        )
        return result

    async def _complete(
        self,
        client: AsyncOpenAI,
        prompt: str,
        reasoning_effort: str | None = None,
        model: str | None = None,
        max_output_tokens: int | None = None,
    ) -> LlmResult:
        """Calls the Responses API, auto-dropping a parameter a model rejects and remembering that
        for next time — the same capability-adaptation pattern used by the SIWC reference client.

        `reasoning_effort` overrides the configured default for cheap, non-analytical calls (greetings,
        acknowledgements) where medium effort burns seconds for nothing.

        The Codex/ChatGPT OAuth backend behind `chatgpt_oauth_cache` requires `input` as a list of
        messages (not a bare string), `store=False`, and `stream=True` — a plain `create()` 400s."""
        model = model or self.settings.openai_model
        kwargs: dict[str, Any] = {
            "model": model,
            "input": [{"role": "user", "content": prompt}],
            "store": False,
            "stream": True,
        }
        with _capability_lock:
            if model not in _models_without_max_output_tokens:
                kwargs["max_output_tokens"] = max_output_tokens or self.settings.ai_max_output_tokens
            if model not in _models_without_reasoning_effort:
                kwargs["reasoning"] = {"effort": reasoning_effort or self.settings.openai_reasoning_effort}

        for attempt in range(1, 4):  # at most: drop max_output_tokens, then drop reasoning, then give up
            try:
                stream = await client.responses.create(**kwargs)
                text = ""
                input_tokens = 0
                output_tokens = 0
                async for event in stream:
                    event_type = getattr(event, "type", "")
                    if event_type == "response.output_text.delta":
                        text += event.delta
                    elif event_type == "response.completed":
                        usage = getattr(event.response, "usage", None)
                        input_tokens = getattr(usage, "input_tokens", 0) or 0
                        output_tokens = getattr(usage, "output_tokens", 0) or 0
                return LlmResult(text, input_tokens, output_tokens, attempt)
            except BadRequestError as exc:
                detail = _safe_error_value(str(exc)).lower()
                if "max_output_tokens" in detail and "max_output_tokens" in kwargs:
                    with _capability_lock:
                        _models_without_max_output_tokens.add(model)
                    kwargs.pop("max_output_tokens", None)
                    continue
                if "reasoning" in detail and "reasoning" in kwargs:
                    with _capability_lock:
                        _models_without_reasoning_effort.add(model)
                    kwargs.pop("reasoning", None)
                    continue
                raise RuntimeError(f"Model {model} rejected the request: {_safe_error_value(str(exc))}") from exc
        raise RuntimeError(f"Model {model} rejected every retry attempt.")

    @staticmethod
    def _fallback(prompt: str, task_type: str) -> str:
        lower = prompt.lower()
        if task_type == "classifier":
            if "compare" in lower or "versus" in lower or " vs " in lower:
                return "compare"
            if "request" in lower or "looking for" in lower or "want a" in lower:
                return "requirements"
            return "advice"
        if task_type == "compare":
            return "The lowest out-the-door total is the strongest starting point. Check delivery timing, included equipment, dealer rating, and every not-reported field before deciding."
        if task_type == "advisor" and (
            match := re.search(r'<web_sources trust="untrusted">(.*?)</web_sources>', prompt, re.DOTALL)
        ):
            try:
                sources = json.loads(match.group(1))
            except (json.JSONDecodeError, TypeError):
                sources = []
            links = [
                f"- [{str(source.get('title') or 'Trusted vehicle source')}]({source['url']})"
                for source in sources[:5]
                if isinstance(source, dict) and source.get("url")
            ]
            if links:
                return (
                    "## I found trusted sources\n"
                    "I couldn’t finish processing the live vehicle details because the AI service is temporarily "
                    "unavailable. I won’t guess at current models, prices, or availability.\n\n"
                    "### Sources\n" + "\n".join(links) + "\n\nTry the search again in a few minutes."
                )
        return "I can help narrow the vehicle, explain ownership trade-offs, compare itemized offers, and prepare an editable buyer request. Tell me your preferred model, budget, location, and timing to start."
