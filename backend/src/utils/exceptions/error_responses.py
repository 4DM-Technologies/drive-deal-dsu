from typing import Any

from pydantic import BaseModel


class ErrorBody(BaseModel):
    code: str
    message: str
    details: Any = None
    request_id: str


class ErrorResponse(BaseModel):
    error: ErrorBody
