import time
from unittest.mock import AsyncMock

import pytest

from src.auth import codex_oauth


@pytest.fixture(autouse=True)
def _empty_memory_token():
    codex_oauth.forget_cached_access_token()
    yield
    codex_oauth.forget_cached_access_token()


async def test_access_token_is_served_from_memory_after_the_first_read(monkeypatch: pytest.MonkeyPatch) -> None:
    load = AsyncMock(return_value="token-1")
    monkeypatch.setattr(codex_oauth, "_load_access_token", load)

    assert await codex_oauth.get_cached_access_token() == "token-1"
    assert await codex_oauth.get_cached_access_token() == "token-1"

    load.assert_awaited_once()


async def test_memory_token_is_reloaded_when_it_is_too_old(monkeypatch: pytest.MonkeyPatch) -> None:
    load = AsyncMock(side_effect=["token-1", "token-2"])
    monkeypatch.setattr(codex_oauth, "_load_access_token", load)
    await codex_oauth.get_cached_access_token()
    codex_oauth._memory_token["loaded_at"] = time.monotonic() - codex_oauth._MEMORY_TOKEN_MAX_AGE_SECONDS - 1

    assert await codex_oauth.get_cached_access_token() == "token-2"


async def test_memory_token_is_reloaded_when_near_expiry(monkeypatch: pytest.MonkeyPatch) -> None:
    load = AsyncMock(side_effect=["token-1", "token-2"])
    monkeypatch.setattr(codex_oauth, "_load_access_token", load)
    monkeypatch.setattr(codex_oauth, "_token_near_expiry", lambda tokens: True)

    await codex_oauth.get_cached_access_token()

    assert await codex_oauth.get_cached_access_token() == "token-2"


async def test_forgotten_token_is_read_again(monkeypatch: pytest.MonkeyPatch) -> None:
    load = AsyncMock(side_effect=["token-1", "token-2"])
    monkeypatch.setattr(codex_oauth, "_load_access_token", load)
    await codex_oauth.get_cached_access_token()

    codex_oauth.forget_cached_access_token()

    assert await codex_oauth.get_cached_access_token() == "token-2"


async def test_missing_token_is_not_kept_in_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    load = AsyncMock(side_effect=[None, "token-1"])
    monkeypatch.setattr(codex_oauth, "_load_access_token", load)

    assert await codex_oauth.get_cached_access_token() is None
    assert await codex_oauth.get_cached_access_token() == "token-1"
