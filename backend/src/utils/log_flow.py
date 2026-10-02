"""Function-level flow logging for every business function in the request path.

Routes -> Services -> Repositories -> Agents/Tools all carry the ``@log_flow``
decorator so a single request can be replayed from the log alone:

    {"event": "api_request_started", "request_id": "...", "method": "POST", "path": "/api/v1/quotes"}
    {"event": "function_entry",  "layer": "route",      "function": "route.create_quote",  "depth": 1}
    {"event": "function_entry",  "layer": "service",    "function": "service.MarketplaceService.create_quote", "depth": 2}
    {"event": "function_entry",  "layer": "repository", "function": "repository.MarketplaceRepository.add",  "depth": 3}
    {"event": "function_exit",   "layer": "repository", "function": "...add",  "depth": 3, "duration_ms": 0.4, "outcome": "ok"}
    {"event": "function_exit",   "layer": "service",    "function": "...create_quote", "depth": 2, "duration_ms": 3.1, "outcome": "ok"}
    {"event": "function_exit",   "layer": "route",      "function": "...create_quote", "depth": 1, "duration_ms": 3.4, "outcome": "ok"}
    {"event": "api_request_completed", "request_id": "...", "status_code": 201, "duration_ms": 6.2}

``depth`` is a context variable incremented on entry, so nested calls are visually
indented in the JSON stream and the exit of a failed call is immediately followed by
the unwind of every parent - that is where you read the traceback and correct the bug.
"""

import asyncio
import functools
import inspect
import time
from collections.abc import AsyncGenerator, Callable
from contextvars import ContextVar, Token
from typing import Any, ParamSpec, TypeVar

from src.settings import (
    LOG_FLOW_ARG_VALUE_LIMIT,
    LOG_FLOW_MAX_ARGS,
    LOG_FLOW_SENSITIVE_PARAMS,
    get_settings,
)
from src.utils.logger import logger

P = ParamSpec("P")
R = TypeVar("R")

SKIPPED_ARG_NAMES = frozenset({"self", "cls", "request", "response", "websocket", "background_tasks"})
SKIPPED_FUNCTION_NAMES = frozenset({"__repr__", "__str__", "__eq__", "__hash__"})
FLOW_LOGGED_ATTR = "__drivedeal_log_flow__"

flow_depth: ContextVar[int] = ContextVar("drivedeal_flow_depth", default=0)

EVENT_FUNCTION_ENTRY = "function_entry"
EVENT_FUNCTION_EXIT = "function_exit"
EVENT_FUNCTION_ERROR = "function_error"

OUTCOME_OK = "ok"
OUTCOME_ERROR = "error"
OUTCOME_CANCELLED = "cancelled"

REDACTED = "***"


def _truncate(value: str, limit: int = LOG_FLOW_ARG_VALUE_LIMIT) -> str:
    return value if len(value) <= limit else f"{value[:limit]}..."


def is_sensitive(name: str) -> bool:
    """True when a parameter name looks like a credential and its value must never be logged."""
    lowered = name.lower()
    return any(marker in lowered for marker in LOG_FLOW_SENSITIVE_PARAMS)


def safe_value(value: Any) -> str:
    """Renders an argument as a short loggable string; a failing ``repr`` must never break the request."""
    if value is None or isinstance(value, bool | int | float):
        return str(value)
    if isinstance(value, str):
        return _truncate(value)
    try:
        return _truncate(repr(value))
    except Exception:
        return f"<unreprable {type(value).__name__}>"


def describe_arguments(func: Callable[..., Any], args: tuple[Any, ...], kwargs: dict[str, Any]) -> dict[str, str]:
    """Maps bound parameter names to short string values so a call is traceable without leaking secrets.

    Variadic parameters are reported as an item count only, credentials are redacted, and the
    result is capped at ``LOG_FLOW_MAX_ARGS`` entries so one huge payload cannot flood the log.
    """
    try:
        signature = inspect.signature(func)
        bound = signature.bind(*args, **kwargs)
    except TypeError:
        return {}
    variadic = {
        name
        for name, parameter in signature.parameters.items()
        if parameter.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD)
    }
    described: dict[str, str] = {}
    for name, value in bound.arguments.items():
        if len(described) >= LOG_FLOW_MAX_ARGS:
            break
        if name in SKIPPED_ARG_NAMES:
            continue
        if name in variadic:
            described[f"{name}_count"] = str(len(value))
        elif is_sensitive(name):
            described[name] = REDACTED
        else:
            described[name] = safe_value(value)
    return described


def qualified_name(func: Callable[..., Any], layer: str) -> str:
    """Namespaces a callable by layer, e.g. ``service.MarketplaceService.create_quote``.

    ``<locals>`` qualname segments are dropped so nested closures still log a readable name.
    """
    owner = getattr(func, "__qualname__", "") or getattr(func, "__name__", "")
    cleaned = ".".join(part for part in owner.split(".") if part != "<locals>")
    return f"{layer}.{cleaned}"


def flow_entry(func: Callable[..., Any], layer: str, depth: int, args: tuple[Any, ...], kwargs: dict[str, Any]) -> None:
    logger.info(
        EVENT_FUNCTION_ENTRY,
        layer=layer,
        function=qualified_name(func, layer),
        depth=depth,
        args=describe_arguments(func, args, kwargs),
    )


def flow_exit(
    token: Token[int],
    depth: int,
    started_at: float,
    func: Callable[..., Any],
    layer: str,
    outcome: str,
    **fields: Any,
) -> None:
    logger.info(
        EVENT_FUNCTION_EXIT,
        layer=layer,
        function=qualified_name(func, layer),
        depth=depth,
        duration_ms=round((time.perf_counter() - started_at) * 1000, 3),
        outcome=outcome,
        **fields,
    )
    if token is not None:
        flow_depth.reset(token)


def is_expected_error(error: BaseException) -> bool:
    """True for deliberate domain rejections (a 404, a forbidden role) rather than a real defect.

    An ``AppError`` is the application saying "no" on purpose, so it is reported as a warning with
    its error code and no stack trace; everything else gets ``logger.exception`` and a full
    traceback, because that is where the bug is.
    """
    from src.utils.exceptions.exceptions import AppError

    return isinstance(error, AppError)


def flow_error(
    token: Token[int],
    depth: int,
    started_at: float,
    func: Callable[..., Any],
    layer: str,
    outcome: str,
    error: BaseException,
    **fields: Any,
) -> None:
    emit = logger.warning if is_expected_error(error) else logger.exception
    emit(
        EVENT_FUNCTION_ERROR,
        layer=layer,
        function=qualified_name(func, layer),
        depth=depth,
        duration_ms=round((time.perf_counter() - started_at) * 1000, 3),
        outcome=outcome,
        error_type=type(error).__name__,
        error=str(error),
        **fields,
    )
    if token is not None:
        flow_depth.reset(token)


def flow_logging_enabled() -> bool:
    """Reads LOG_FLOW_ENABLED from settings at import time, defaulting to enabled."""
    try:
        return get_settings().log_flow_enabled
    except Exception:
        return True


def _sync_wrapper(func: Callable[P, R], layer: str) -> Callable[P, R]:
    @functools.wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        started_at = time.perf_counter()
        depth = flow_depth.get()
        token = flow_depth.set(depth + 1)
        flow_entry(func, layer, depth, args, kwargs)
        try:
            result = func(*args, **kwargs)
        except asyncio.CancelledError as exc:
            flow_error(token, depth, started_at, func, layer, OUTCOME_CANCELLED, exc)
            raise
        except Exception as exc:
            flow_error(token, depth, started_at, func, layer, OUTCOME_ERROR, exc)
            raise
        flow_exit(token, depth, started_at, func, layer, OUTCOME_OK)
        return result

    return wrapper


def _async_wrapper(func: Callable[P, Any], layer: str) -> Callable[P, Any]:
    @functools.wraps(func)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> Any:
        started_at = time.perf_counter()
        depth = flow_depth.get()
        token = flow_depth.set(depth + 1)
        flow_entry(func, layer, depth, args, kwargs)
        try:
            result = await func(*args, **kwargs)
        except asyncio.CancelledError as exc:
            flow_error(token, depth, started_at, func, layer, OUTCOME_CANCELLED, exc)
            raise
        except Exception as exc:
            flow_error(token, depth, started_at, func, layer, OUTCOME_ERROR, exc)
            raise
        flow_exit(token, depth, started_at, func, layer, OUTCOME_OK)
        return result

    return wrapper


def _async_gen_wrapper(func: Callable[P, Any], layer: str) -> Callable[P, AsyncGenerator[Any, None]]:
    @functools.wraps(func)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> AsyncGenerator[Any, None]:
        started_at = time.perf_counter()
        depth = flow_depth.get()
        token = flow_depth.set(depth + 1)
        emitted = 0
        flow_entry(func, layer, depth, args, kwargs)
        try:
            async for item in func(*args, **kwargs):
                emitted += 1
                yield item
        except asyncio.CancelledError as exc:
            flow_error(token, depth, started_at, func, layer, OUTCOME_CANCELLED, exc, items=emitted)
            raise
        except Exception as exc:
            flow_error(token, depth, started_at, func, layer, OUTCOME_ERROR, exc, items=emitted)
            raise
        flow_exit(token, depth, started_at, func, layer, OUTCOME_OK, items=emitted)

    return wrapper


def log_flow(
    func: Callable[P, R] | None = None,
    *,
    layer: str,
) -> Callable[P, R] | Callable[[Callable[P, R]], Callable[P, R]]:
    """Logs ``function_entry`` / ``function_exit`` / ``function_error`` around every call.

    Always used parameterised (``@log_flow(layer="service")``): ``layer`` is keyword-only and
    required so every call site states which layer of the request path it belongs to. Handles sync
    functions, coroutines and async generators, and keeps ``functools.wraps`` metadata so FastAPI,
    SQLAlchemy and pytest continue to resolve the original signature and return annotation.
    """

    def decorator(target: Callable[P, R]) -> Callable[P, R]:
        if getattr(target, FLOW_LOGGED_ATTR, False) or target.__name__ in SKIPPED_FUNCTION_NAMES:
            return target
        if not flow_logging_enabled():
            return target
        if inspect.isasyncgenfunction(target):
            wrapped: Callable[P, Any] = _async_gen_wrapper(target, layer)
        elif inspect.iscoroutinefunction(target):
            wrapped = _async_wrapper(target, layer)
        else:
            wrapped = _sync_wrapper(target, layer)
        setattr(wrapped, FLOW_LOGGED_ATTR, True)
        return wrapped

    if func is not None:
        return decorator(func)
    return decorator
