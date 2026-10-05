from unittest.mock import AsyncMock

import pytest

from src.auth import codex_oauth


class FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text or str(payload)

    def json(self) -> dict:
        return self._payload


class FakeHttpClient:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self._responses = list(responses)
        self.calls: list[tuple[str, dict]] = []

    async def post(self, url: str, json: dict | None = None, **_: object) -> FakeResponse:
        self.calls.append((url, json or {}))
        return self._responses.pop(0)


async def test_request_device_code_returns_parsed_fields() -> None:
    client = FakeHttpClient([FakeResponse(200, {"device_auth_id": "d1", "user_code": "ABCD-1234", "interval": "5"})])

    result = await codex_oauth._request_device_code(client, "client-123")

    assert result == {"device_auth_id": "d1", "user_code": "ABCD-1234", "interval": 5}
    assert client.calls[0][1] == {"client_id": "client-123"}


async def test_request_device_code_accepts_usercode_alias_and_bad_interval() -> None:
    client = FakeHttpClient([FakeResponse(200, {"device_auth_id": "d1", "usercode": "ABCD-1234", "interval": "oops"})])

    result = await codex_oauth._request_device_code(client, "client-123")

    assert result["user_code"] == "ABCD-1234"
    assert result["interval"] == codex_oauth.CODEX_OAUTH_DEVICE_DEFAULT_POLL_INTERVAL_SECONDS


async def test_request_device_code_404_means_feature_not_enabled() -> None:
    client = FakeHttpClient([FakeResponse(404, {"error": "not found"})])

    with pytest.raises(RuntimeError, match="not enabled"):
        await codex_oauth._request_device_code(client, "client-123")


async def test_request_device_code_other_error_raises_with_status() -> None:
    client = FakeHttpClient([FakeResponse(500, text="boom")])

    with pytest.raises(RuntimeError, match="500"):
        await codex_oauth._request_device_code(client, "client-123")


async def test_request_device_code_missing_fields_raises() -> None:
    client = FakeHttpClient([FakeResponse(200, {"interval": "5"})])

    with pytest.raises(RuntimeError, match="missing"):
        await codex_oauth._request_device_code(client, "client-123")


async def test_poll_for_device_code_succeeds_after_one_pending_attempt(monkeypatch: pytest.MonkeyPatch) -> None:
    client = FakeHttpClient(
        [
            FakeResponse(403, {"error": "pending"}),
            FakeResponse(200, {"authorization_code": "code", "code_challenge": "chal", "code_verifier": "verifier"}),
        ]
    )
    monkeypatch.setattr(codex_oauth.asyncio, "sleep", AsyncMock())

    result = await codex_oauth._poll_for_device_code(client, "d1", "ABCD-1234", interval=1)

    assert result == {"authorization_code": "code", "code_challenge": "chal", "code_verifier": "verifier"}
    assert len(client.calls) == 2


async def test_poll_for_device_code_rejects_incomplete_success_response() -> None:
    client = FakeHttpClient([FakeResponse(200, {"authorization_code": "code"})])

    with pytest.raises(RuntimeError, match="code_challenge"):
        await codex_oauth._poll_for_device_code(client, "d1", "ABCD-1234", interval=1)


async def test_poll_for_device_code_raises_on_unexpected_status() -> None:
    client = FakeHttpClient([FakeResponse(401, text="nope")])

    with pytest.raises(RuntimeError, match="401"):
        await codex_oauth._poll_for_device_code(client, "d1", "ABCD-1234", interval=1)


async def test_poll_for_device_code_times_out(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(codex_oauth, "CODEX_OAUTH_DEVICE_POLL_TIMEOUT_SECONDS", 0)
    client = FakeHttpClient([FakeResponse(403, {"error": "pending"})])

    with pytest.raises(RuntimeError, match="timed out"):
        await codex_oauth._poll_for_device_code(client, "d1", "ABCD-1234", interval=1)
