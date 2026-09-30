from dataclasses import dataclass
from time import perf_counter

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.schema import LlmAudit
from src.settings import get_settings


@dataclass
class LlmResult:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0


class LlmClient:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.settings = get_settings()
        credential = self.settings.openai_api_key or self.settings.codex_oauth_access_token
        self.client = AsyncOpenAI(api_key=credential, timeout=self.settings.ai_request_timeout_seconds) if credential else None

    async def generate(self, prompt: str, task_type: str, thread_id: str | None = None) -> LlmResult:
        started = perf_counter()
        status = "fallback"
        if self.client:
            try:
                response = await self.client.responses.create(
                    model=self.settings.openai_model,
                    reasoning={"effort": self.settings.openai_reasoning_effort},
                    max_output_tokens=self.settings.ai_max_output_tokens,
                    input=prompt,
                )
                usage = response.usage
                result = LlmResult(response.output_text, getattr(usage, "input_tokens", 0), getattr(usage, "output_tokens", 0))
                status = "success"
            except Exception:
                result = LlmResult(self._fallback(prompt, task_type))
                status = "provider_fallback"
        else:
            result = LlmResult(self._fallback(prompt, task_type))
        elapsed = int((perf_counter() - started) * 1000)
        self.session.add(LlmAudit(
            task_type=task_type, provider="openai" if self.client else "deterministic",
            model_name=self.settings.openai_model if self.client else "drivedeal-dev-fallback", thread_id=thread_id,
            input_tokens=result.input_tokens, output_tokens=result.output_tokens,
            total_tokens=result.input_tokens + result.output_tokens, latency_ms=elapsed, status=status,
        ))
        await self.session.flush()
        return result

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
        return "I can help narrow the vehicle, explain ownership trade-offs, compare itemized offers, and prepare an editable buyer request. Tell me your preferred model, budget, location, and timing to start."
