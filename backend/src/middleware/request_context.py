import time
from uuid import uuid4

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from src.settings import LOG_QUERY_STRING, REQUEST_CONTEXT_LOGGED_METHODS, REQUEST_CONTEXT_SKIPPED_PATHS
from src.utils.log_flow import log_flow
from src.utils.logger import logger


def resolve_request_id(request: Request) -> str:
    """Honours an upstream ``x-request-id`` so a single trace spans every service it touches."""
    return request.headers.get("x-request-id") or str(uuid4())


def describe_request(request: Request) -> dict[str, object]:
    """Summarises the request for ``api_request_started``; the query string is opt-in via settings."""
    described: dict[str, object] = {
        "method": request.method,
        "path": request.url.path,
        "client": request.client.host if request.client else None,
    }
    if LOG_QUERY_STRING and request.url.query:
        described["query"] = request.url.query[:256]
    return described


def log_completion(request: Request, response: Response, request_id: str, started_at: float) -> None:
    """Emits one completion line per request; 4xx is a warning, 5xx an error, everything else info."""
    fields: dict[str, object] = {
        "request_id": request_id,
        "method": request.method,
        "path": request.url.path,
        "status_code": response.status_code,
        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
    }
    if request.method in REQUEST_CONTEXT_LOGGED_METHODS:
        fields["operation"] = f"{request.method} {request.url.path}"
    if response.status_code >= 500:
        logger.error("api_request_completed", **fields)
    elif response.status_code >= 400:
        logger.warning("api_request_completed", **fields)
    else:
        logger.info("api_request_completed", **fields)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Binds the per-request context variables and emits the API flow log lines.

    ``api_request_started`` / ``api_request_completed`` / ``api_request_failed`` bracket the whole
    request, so grepping one ``request_id`` yields the API entry point, then every
    ``function_entry`` / ``function_exit`` line from the middleware, route, service, repository and
    agent layers underneath it, then the final outcome. That is the trace you follow when a request
    fails and you need to know which function broke it.
    """

    @log_flow(layer="middleware")
    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = resolve_request_id(request)
        request.state.request_id = request_id
        structlog.contextvars.bind_contextvars(request_id=request_id, path=request.url.path, method=request.method)
        started_at = time.perf_counter()
        should_log = request.url.path not in REQUEST_CONTEXT_SKIPPED_PATHS
        if should_log:
            logger.info("api_request_started", request_id=request_id, **describe_request(request))
        try:
            response = await call_next(request)
        except Exception as exc:
            if should_log:
                logger.exception(
                    "api_request_failed",
                    request_id=request_id,
                    method=request.method,
                    path=request.url.path,
                    duration_ms=round((time.perf_counter() - started_at) * 1000, 3),
                    error_type=type(exc).__name__,
                    error=str(exc),
                )
            raise
        response.headers["x-request-id"] = request_id
        if should_log:
            log_completion(request, response, request_id, started_at)
        return response
