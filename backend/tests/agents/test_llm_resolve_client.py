from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.agents import llm as llm_module
from src.agents.llm import LlmClient
from src.settings import CODEX_DIRECT_BASE_URL, CODEX_DIRECT_USER_AGENT


def _client(**overrides) -> LlmClient:
    defaults = {"openai_api_key": None, "codex_oauth_access_token": None, "ai_request_timeout_seconds": 45}
    settings = SimpleNamespace(**{**defaults, **overrides})
    instance = LlmClient.__new__(LlmClient)
    instance.session = None
    instance.settings = settings
    instance._credential_source = "deterministic"
    return instance


async def test_resolve_client_prefers_api_key_and_targets_public_openai(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(openai_api_key="sk-test")
    monkeypatch.setattr(llm_module, "get_cached_access_token", AsyncMock(return_value="should-not-be-used"))

    resolved = await client._resolve_client()

    assert client._credential_source == "api_key"
    assert str(resolved.base_url) == "https://api.openai.com/v1/"


async def test_resolve_client_uses_env_chatgpt_oauth_token_against_codex_backend() -> None:
    client = _client(codex_oauth_access_token="env-token")  # noqa: S106

    resolved = await client._resolve_client()

    assert client._credential_source == "chatgpt_oauth_env"
    assert str(resolved.base_url) == f"{CODEX_DIRECT_BASE_URL}/"
    assert resolved.default_headers.get("User-Agent") == CODEX_DIRECT_USER_AGENT


async def test_resolve_client_falls_back_to_cached_token_against_codex_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client()
    monkeypatch.setattr(llm_module, "get_cached_access_token", AsyncMock(return_value="cached-token"))

    resolved = await client._resolve_client()

    assert client._credential_source == "chatgpt_oauth_cache"
    assert str(resolved.base_url) == f"{CODEX_DIRECT_BASE_URL}/"


async def test_resolve_client_is_none_when_no_credential_available(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client()
    monkeypatch.setattr(llm_module, "get_cached_access_token", AsyncMock(return_value=None))

    resolved = await client._resolve_client()

    assert resolved is None
    assert client._credential_source == "deterministic"


async def test_resolve_client_reuses_one_client_while_the_credential_is_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(llm_module, "_shared_clients", {})
    monkeypatch.setattr(llm_module, "get_cached_access_token", AsyncMock(return_value="cached-token"))

    first = await _client()._resolve_client()
    second = await _client()._resolve_client()

    assert first is second


async def test_resolve_client_builds_a_new_client_when_the_token_changes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm_module, "_shared_clients", {})
    monkeypatch.setattr(llm_module, "get_cached_access_token", AsyncMock(side_effect=["old-token", "new-token"]))

    first = await _client()._resolve_client()
    second = await _client()._resolve_client()

    assert first is not second
    assert second.api_key == "new-token"


async def test_resolve_client_keeps_separate_clients_per_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm_module, "_shared_clients", {})
    monkeypatch.setattr(llm_module, "get_cached_access_token", AsyncMock(return_value="cached-token"))

    normal = await _client()._resolve_client()
    short = await _client(ai_request_timeout_seconds=4)._resolve_client()

    assert normal is not short
    assert short.timeout == 4


async def test_warm_up_is_skipped_when_ai_is_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    resolve = AsyncMock()
    monkeypatch.setattr(LlmClient, "_resolve_client", resolve)

    await llm_module.warm_up_provider()

    resolve.assert_not_awaited()


async def test_warm_up_never_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        llm_module, "get_settings", lambda: SimpleNamespace(ai_disabled=False, ai_request_timeout_seconds=45)
    )
    monkeypatch.setattr(LlmClient, "_resolve_client", AsyncMock(side_effect=RuntimeError("S3 unreachable")))

    await llm_module.warm_up_provider()
