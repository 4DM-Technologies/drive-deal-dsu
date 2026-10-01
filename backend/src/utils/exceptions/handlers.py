from uuid import uuid4

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from src.utils.exceptions import error_codes
from src.utils.exceptions.exceptions import AppError
from src.utils.logger import logger


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", str(uuid4()))


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    logger.warning("app_error", request_id=_request_id(request), path=request.url.path, code=exc.code, status_code=exc.status_code)
    return JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.code, "message": exc.message, "details": exc.details, "request_id": _request_id(request)}})


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": {"code": error_codes.VALIDATION_ERROR, "message": "The request contains invalid data.", "details": exc.errors(), "request_id": _request_id(request)}})


async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled_exception", request_id=_request_id(request), path=request.url.path)
    return JSONResponse(status_code=500, content={"error": {"code": error_codes.INTERNAL_ERROR, "message": "The server could not complete the request.", "details": None, "request_id": _request_id(request)}})
