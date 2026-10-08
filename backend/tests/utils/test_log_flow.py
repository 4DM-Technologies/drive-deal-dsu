"""Tests for the function flow logger and the API flow middleware."""

from typing import Any

import pytest
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from src.middleware import request_context
from src.middleware.request_context import RequestContextMiddleware, describe_request, resolve_request_id
from src.utils import log_flow as module
from src.utils.log_flow import (
    EVENT_FUNCTION_ERROR,
    OUTCOME_CANCELLED,
    OUTCOME_ERROR,
    describe_arguments,
    flow_depth,
    is_expected_error,
    is_sensitive,
    log_flow,
    qualified_name,
    safe_value,
)


@pytest.fixture
def records(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Captures every structured field the decorator emits instead of writing JSON to stdout."""
    captured: list[dict[str, Any]] = []
    for level in ("info", "warning", "error", "exception"):
        monkeypatch.setattr(
            module.logger,
            level,
            lambda event, *args, _level=level, **fields: captured.append({"event": event, "level": _level, **fields}),
        )
    return captured


def events(records: list[dict[str, Any]], name: str) -> list[dict[str, Any]]:
    return [record for record in records if record["event"] == name]


# --------------------------------------------------------------------------------------- helpers


def test_safe_value_primitives() -> None:
    assert safe_value(None) == "None"
    assert safe_value(7) == "7"
    assert safe_value(True) == "True"
    assert safe_value(1.5) == "1.5"


def test_safe_value_truncates_long_strings() -> None:
    rendered = safe_value("x" * 500)
    assert len(rendered) <= module.LOG_FLOW_ARG_VALUE_LIMIT + 3
    assert rendered.endswith("...")


def test_safe_value_survives_failing_repr() -> None:
    class Hostile:
        def __repr__(self) -> str:
            raise RuntimeError("no repr for you")

    assert safe_value(Hostile()) == "<unreprable Hostile>"


@pytest.mark.parametrize(
    ("name", "expected"),
    [("password", True), ("access_token", True), ("api_key", True), ("client_secret", True), ("email", False)],
)
def test_is_sensitive(name: str, expected: bool) -> None:
    assert is_sensitive(name) is expected


def test_describe_arguments_redacts_credentials() -> None:
    def handler(email: str, password: str) -> None: ...

    described = describe_arguments(handler, ("a@b.c", "hunter2"), {})
    assert described == {"email": "a@b.c", "password": "***"}


def test_describe_arguments_counts_variadic_parameters() -> None:
    def handler(*args: int, **kwargs: str) -> None: ...

    described = describe_arguments(handler, (1, 2), {"a": "b"})
    assert described == {"args_count": "2", "kwargs_count": "1"}


def test_describe_arguments_returns_empty_for_unbindable_call() -> None:
    def handler(required: str) -> None: ...

    assert describe_arguments(handler, (), {}) == {}


def test_describe_arguments_caps_argument_count() -> None:
    def handler(**kwargs: int) -> None: ...

    assert len(describe_arguments(handler, (), {str(index): index for index in range(50)})) == 1


def test_describe_arguments_skips_injected_frameworks_objects() -> None:
    class Request: ...

    def handler(request: Request, real: str) -> None: ...

    assert describe_arguments(handler, (Request(), "kept"), {}) == {"real": "kept"}


def test_qualified_name_prefixes_layer() -> None:
    def free_function() -> None: ...

    assert qualified_name(free_function, "route") == "route.test_qualified_name_prefixes_layer.free_function"


def test_qualified_name_includes_class() -> None:
    class Service:
        def run(self) -> None: ...

    assert qualified_name(Service.run, "service") == "service.test_qualified_name_includes_class.Service.run"


def test_qualified_name_matches_real_service_layer() -> None:
    from src.services.auth_service import AuthService

    assert qualified_name(AuthService.login, "service") == "service.AuthService.login"


# --------------------------------------------------------------------------------- sync wrapper


def test_log_flow_sync_success(records: list[dict[str, Any]]) -> None:
    @log_flow(layer="service")
    def add(a: int, b: int) -> int:
        return a + b

    assert add(1, 2) == 3
    assert events(records, EVENT_FUNCTION_ERROR) == []


def test_log_flow_sync_error_propagates(records: list[dict[str, Any]]) -> None:
    @log_flow(layer="service")
    def boom() -> None:
        raise ValueError("kaboom")

    with pytest.raises(ValueError, match="kaboom"):
        boom()
    error = events(records, EVENT_FUNCTION_ERROR)[0]
    assert error["outcome"] == OUTCOME_ERROR
    assert error["error_type"] == "ValueError"
    assert error["error"] == "kaboom"
    assert error["level"] == "exception"


def test_log_flow_cancellation_is_reported_as_cancelled(records: list[dict[str, Any]]) -> None:
    @log_flow(layer="service")
    def cancelled() -> None:
        raise module.asyncio.CancelledError

    with pytest.raises(module.asyncio.CancelledError):
        cancelled()
    assert events(records, EVENT_FUNCTION_ERROR)[0]["outcome"] == OUTCOME_CANCELLED


def test_is_expected_error_recognises_domain_rejection() -> None:
    from src.utils.exceptions import AppError, error_codes

    assert is_expected_error(AppError(error_codes.RESOURCE_NOT_FOUND, "Vehicle not found.", 404)) is True
    assert is_expected_error(ValueError("kaboom")) is False


def test_log_flow_domain_error_logs_warning_without_traceback(records: list[dict[str, Any]]) -> None:
    from src.utils.exceptions import AppError, error_codes

    @log_flow(layer="route")
    def missing() -> None:
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "Vehicle not found.", 404)

    with pytest.raises(AppError):
        missing()
    error = events(records, EVENT_FUNCTION_ERROR)[0]
    assert error["level"] == "warning"
    assert error["error_type"] == "AppError"
    assert error["error"] == "Vehicle not found."


def test_log_flow_requires_layer() -> None:
    with pytest.raises(TypeError):
        log_flow(lambda: None)  # type: ignore[call-arg]


def test_log_flow_is_idempotent(records: list[dict[str, Any]]) -> None:
    @log_flow(layer="service")
    @log_flow(layer="service")
    def once() -> None: ...

    once()
    assert records == []


def test_log_flow_skips_dunder_methods() -> None:
    def __repr__(self) -> str:
        return "raw"

    assert getattr(log_flow(layer="service")(__repr__), module.FLOW_LOGGED_ATTR, False) is False


def test_log_flow_preserves_signature_and_metadata() -> None:
    @log_flow(layer="service")
    def documented(a: int, b: str = "x") -> str:
        """Docstring stays."""
        return b * a

    assert documented.__name__ == "documented"
    assert documented.__doc__ == "Docstring stays."
    assert list(module.inspect.signature(documented).parameters) == ["a", "b"]


def test_log_flow_disabled_via_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(module, "flow_logging_enabled", lambda: False)

    @log_flow(layer="service")
    def untouched() -> int:
        return 1

    assert getattr(untouched, module.FLOW_LOGGED_ATTR, False) is False


# ------------------------------------------------------------------------------- async wrapper


async def test_log_flow_async_success(records: list[dict[str, Any]]) -> None:
    @log_flow(layer="service")
    async def fetch(value: int) -> int:
        return value * 2

    assert await fetch(21) == 42
    assert events(records, EVENT_FUNCTION_ERROR) == []


async def test_log_flow_async_error(records: list[dict[str, Any]]) -> None:
    @log_flow(layer="service")
    async def failing() -> None:
        raise RuntimeError("nope")

    with pytest.raises(RuntimeError, match="nope"):
        await failing()
    error = events(records, EVENT_FUNCTION_ERROR)[0]
    assert error["error_type"] == "RuntimeError"
    assert error["error"] == "nope"


async def test_log_flow_async_cancellation(records: list[dict[str, Any]]) -> None:
    @log_flow(layer="service")
    async def cancelled() -> None:
        raise module.asyncio.CancelledError

    with pytest.raises(module.asyncio.CancelledError):
        await cancelled()
    assert events(records, EVENT_FUNCTION_ERROR)[0]["outcome"] == OUTCOME_CANCELLED


# ----------------------------------------------------------------------------- async generator


async def test_log_flow_async_generator_counts_items(records: list[dict[str, Any]]) -> None:
    @log_flow(layer="service")
    async def stream() -> Any:
        for index in range(3):
            yield index

    assert [item async for item in stream()] == [0, 1, 2]
    assert events(records, EVENT_FUNCTION_ERROR) == []
    assert flow_depth.get() == 0


async def test_log_flow_async_generator_error(records: list[dict[str, Any]]) -> None:
    @log_flow(layer="service")
    async def stream() -> Any:
        yield 1
        raise ValueError("mid-stream")

    collected = []
    with pytest.raises(ValueError, match="mid-stream"):
        async for item in stream():
            collected.append(item)
    assert collected == [1]
    error = events(records, EVENT_FUNCTION_ERROR)[0]
    assert error["items"] == 1
    assert error["error_type"] == "ValueError"


# ------------------------------------------------------------------------------------- nesting


async def test_log_flow_tracks_nesting_depth(records: list[dict[str, Any]]) -> None:
    @log_flow(layer="repository")
    async def repository_call() -> str:
        return "row"

    @log_flow(layer="service")
    async def service_call() -> str:
        return await repository_call()

    @log_flow(layer="route")
    async def route_call() -> str:
        return await service_call()

    assert await route_call() == "row"
    assert records == []
    assert flow_depth.get() == 0


def test_log_flow_restores_depth_after_error(records: list[dict[str, Any]]) -> None:
    @log_flow(layer="service")
    def boom() -> None:
        raise ValueError("kaboom")

    for _ in range(2):
        with pytest.raises(ValueError):
            boom()
    assert flow_depth.get() == 0
    assert len(events(records, EVENT_FUNCTION_ERROR)) == 2
    assert [record["depth"] for record in events(records, EVENT_FUNCTION_ERROR)] == [0, 0]
    assert flow_depth.get() == 0


# --------------------------------------------------------------------------------- middleware


class Recorder:
    """Minimal structlog stand-in: records the event name, level and keyword fields."""

    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []

    def _record(self, level: str, event: str, **fields: Any) -> None:
        self.records.append({"event": event, "level": level, **fields})

    def info(self, event: str, **fields: Any) -> None:
        self._record("info", event, **fields)

    def warning(self, event: str, **fields: Any) -> None:
        self._record("warning", event, **fields)

    def error(self, event: str, **fields: Any) -> None:
        self._record("error", event, **fields)

    def exception(self, event: str, **fields: Any) -> None:
        self._record("exception", event, **fields)


async def _ok_endpoint(_: object) -> JSONResponse:
    return JSONResponse({"status": "ok"})


async def _boom_endpoint(_: object) -> JSONResponse:
    raise RuntimeError("endpoint exploded")


def build_app() -> Starlette:
    app = Starlette(
        routes=[
            Route("/ok", _ok_endpoint, methods=["GET"]),
            Route("/boom", _boom_endpoint, methods=["GET"]),
        ]
    )
    app.add_middleware(RequestContextMiddleware)
    return app


def test_resolve_request_id_uses_upstream_header() -> None:
    class FakeRequest:
        headers = {"x-request-id": "upstream-123"}

    assert resolve_request_id(FakeRequest()) == "upstream-123"


def test_resolve_request_id_generates_when_missing() -> None:
    class FakeRequest:
        headers: dict[str, str] = {}

    assert len(resolve_request_id(FakeRequest())) == 36


def test_describe_request_includes_method_path_and_client() -> None:
    class FakeURL:
        path = "/api/v1/quotes"
        query = "limit=5"

    class FakeClient:
        host = "127.0.0.1"

    class FakeRequest:
        method = "GET"
        url = FakeURL()
        client = FakeClient()

    assert describe_request(FakeRequest()) == {
        "method": "GET",
        "path": "/api/v1/quotes",
        "client": "127.0.0.1",
        "query": "limit=5",
    }


def test_api_flow_logs_request_lifecycle(monkeypatch: pytest.MonkeyPatch) -> None:
    recorder = Recorder()
    monkeypatch.setattr(request_context, "logger", recorder)
    with TestClient(build_app()) as client:
        response = client.get("/ok", headers={"x-request-id": "trace-abc"})

    assert response.headers["x-request-id"] == "trace-abc"
    flow = [record for record in recorder.records if record["event"].startswith("api_request")]
    assert [record["event"] for record in flow] == ["api_request_started", "api_request_completed"]
    assert all(record["request_id"] == "trace-abc" for record in flow)
    assert flow[0]["path"] == "/ok"
    assert flow[0]["method"] == "GET"
    assert flow[-1]["status_code"] == 200
    assert flow[-1]["operation"] == "GET /ok"
    assert flow[-1]["level"] == "info"
    assert flow[-1]["duration_ms"] >= 0


def test_api_flow_logs_failure_with_traceback(monkeypatch: pytest.MonkeyPatch) -> None:
    recorder = Recorder()
    monkeypatch.setattr(request_context, "logger", recorder)
    with TestClient(build_app()), pytest.raises(RuntimeError, match="endpoint exploded"):
        build_client = TestClient(build_app())
        with build_client:
            build_client.get("/boom")

    failure = [record for record in recorder.records if record["event"] == "api_request_failed"]
    assert len(failure) == 1
    assert failure[0]["error_type"] == "RuntimeError"
    assert failure[0]["error"] == "endpoint exploded"
    assert failure[0]["level"] == "exception"


def test_api_flow_downgrades_client_errors_to_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    recorder = Recorder()
    monkeypatch.setattr(request_context, "logger", recorder)
    with TestClient(build_app()) as client:
        response = client.get("/missing")

    assert response.status_code == 404
    completion = next(record for record in recorder.records if record["event"] == "api_request_completed")
    assert completion["level"] == "warning"
    assert completion["status_code"] == 404


def test_api_flow_skips_noise_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    recorder = Recorder()
    monkeypatch.setattr(request_context, "logger", recorder)
    app = Starlette(routes=[Route("/health", _ok_endpoint, methods=["GET"])])
    app.add_middleware(RequestContextMiddleware)
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert [record for record in recorder.records if record["event"].startswith("api_request")] == []
