from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.middleware.auth import require_roles
from src.models.marketplace import ReportCreate, ReportUpdate
from src.repositories.schema import Profile
from src.services.report_service import ReportService, read_report_uploads
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow

router = APIRouter(tags=["Reports"])


@router.post("/reports", status_code=status.HTTP_201_CREATED)
@log_flow(layer="route")
async def create_report(
    quote_id: Annotated[str, Form()],
    reason: Annotated[str, Form()],
    details: Annotated[str, Form()],
    confirm_accurate: Annotated[bool, Form()],
    include_conversation: Annotated[bool, Form()] = True,
    files: Annotated[list[UploadFile] | None, File()] = None,
    profile: Profile = Depends(require_roles("buyer", "dealer")),
    session: AsyncSession = Depends(get_session),
):
    """Reports the other person in one of the caller's conversations (multipart form fields plus optional ``files``:
    up to 3 JPG/PNG/WebP screenshots, 5 MB each). The reported person is taken from the conversation."""
    # Multipart fields are checked by the same model a JSON body would be.
    try:
        payload = ReportCreate(
            quote_id=quote_id,
            reason=reason,
            details=details,
            confirm_accurate=confirm_accurate,
            include_conversation=include_conversation,
        )
    except ValidationError as exc:
        first = exc.errors()[0]
        message = str(first["msg"]).removeprefix("Value error, ")
        raise AppError(
            error_codes.VALIDATION_ERROR, message, 422, details={"field": first["loc"][0] if first["loc"] else None}
        ) from exc
    uploads = await read_report_uploads(files or [])
    return await ReportService(session).create_report(payload, uploads, profile)


@router.get("/support/reports")
@log_flow(layer="route")
async def list_reports(
    _: Profile = Depends(require_roles("support", "support-admin", "admin")),
    session: AsyncSession = Depends(get_session),
):
    return await ReportService(session).list_reports()


@router.get("/support/reports/{report_id}")
@log_flow(layer="route")
async def get_report(
    report_id: str,
    _: Profile = Depends(require_roles("support", "support-admin", "admin")),
    session: AsyncSession = Depends(get_session),
):
    return await ReportService(session).get_report(report_id)


@router.patch("/support/reports/{report_id}")
@log_flow(layer="route")
async def update_report(
    report_id: str,
    payload: ReportUpdate,
    profile: Profile = Depends(require_roles("support", "support-admin", "admin")),
    session: AsyncSession = Depends(get_session),
):
    return await ReportService(session).update_report(report_id, payload, profile)


@router.get("/support/reports/{report_id}/attachments/{attachment_id}/view")
@log_flow(layer="route")
async def view_report_attachment(
    report_id: str,
    attachment_id: str,
    _: Profile = Depends(require_roles("support", "support-admin", "admin")),
    session: AsyncSession = Depends(get_session),
):
    return await ReportService(session).attachment_link(report_id, attachment_id)
