from types import SimpleNamespace

import httpx
import pytest
from openai import APIError, RateLimitError

from src.agents import llm as llm_module
from src.agents.llm import LlmClient

_REQUEST = httpx.Request("POST", "https://chatgpt.com/backend-api/codex/responses")


def _client() -> LlmClient:
    instance = LlmClient.__new__(LlmClient)
    instance.session = None
    instance.settings = SimpleNamespace(
        openai_model="test-model", ai_max_output_tokens=100, openai_reasoning_effort="low"
    )
    instance._credential_source = "chatgpt_oauth_cache"
    return instance


def _stream(text: str):
    async def events():
        yield SimpleNamespace(type="response.output_text.delta", delta=text)

    return events()


class _FakeResponses:
    def __init__(self, failures: list[Exception], text: str = "ok") -> None:
        self.failures = list(failures)
        self.text = text
        self.calls = 0

    async def create(self, **_kwargs):
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return _stream(self.text)


def _openai(responses: _FakeResponses):
    return SimpleNamespace(responses=responses)


def _stream_error() -> APIError:
    # What the SDK raises for an error event inside a 200 stream.
    return APIError("An error occurred while processing your request.", request=_REQUEST, body=None)


@pytest.fixture(autouse=True)
def _no_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm_module, "_TRANSIENT_BACKOFF_SECONDS", 0)


async def test_mid_stream_error_is_retried_then_succeeds() -> None:
    responses = _FakeResponses([_stream_error()], text="found it")

    result = await _client()._complete(_openai(responses), "prompt")

    assert result.text == "found it"
    assert responses.calls == 2


async def test_transient_errors_give_up_after_retry_budget() -> None:
    responses = _FakeResponses([_stream_error() for _ in range(llm_module._TRANSIENT_RETRIES + 1)])

    with pytest.raises(APIError):
        await _client()._complete(_openai(responses), "prompt")

    assert responses.calls == llm_module._TRANSIENT_RETRIES + 1


async def test_image_search_can_skip_provider_retries() -> None:
    responses = _FakeResponses([_stream_error()])

    with pytest.raises(APIError):
        await _client()._complete(_openai(responses), "prompt", transient_retries=0)

    assert responses.calls == 1


async def test_rate_limit_is_not_retried() -> None:
    rate_limited = RateLimitError("slow down", response=httpx.Response(429, request=_REQUEST), body=None)
    responses = _FakeResponses([rate_limited])

    with pytest.raises(RateLimitError):
        await _client()._complete(_openai(responses), "prompt")

    assert responses.calls == 1
