import re
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.middleware.auth import get_current_profile, require_roles
from src.repositories.schema import DealDocument, DealQuote, Profile
from src.services.storage import get_storage
from src.settings import UPLOAD_DIRECTORY
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow
from src.utils.logger import logger
from src.utils.serialization import model_dict

router = APIRouter(prefix="/documents", tags=["Documents"])


@log_flow(layer="route")
def _local_path(key: str):
    resolved = (UPLOAD_DIRECTORY / key).resolve()
    if UPLOAD_DIRECTORY.resolve() not in resolved.parents:
        raise AppError(error_codes.VALIDATION_ERROR, "Invalid storage key.", 400)
    return resolved


@router.put("/local/{key:path}", status_code=status.HTTP_204_NO_CONTENT)
@log_flow(layer="route")
async def upload_local(key: str, request: Request) -> Response:
    path = _local_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(await request.body())
    logger.info("local_upload", key=key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/local/{key:path}")
@log_flow(layer="route")
async def download_local(key: str, download: bool = False, filename: str | None = None):
    path = _local_path(key)
    if not path.is_file():
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "File not found.", 404)
    logger.info("local_download", key=key)
    return FileResponse(path, filename=Path(filename).name if download and filename else None)


class PresignRequest(BaseModel):
    filename: str
    content_type: str
    quote_id: str
    document_type: str = "quote_document"
    size_bytes: int | None = None


class ConfirmUploadRequest(BaseModel):
    quote_id: str
    document_type: str
    object_key: str


@router.post("/presign")
@log_flow(layer="route")
async def presign(
    payload: PresignRequest,
    profile: Profile = Depends(require_roles("dealer")),
    session: AsyncSession = Depends(get_session),
):
    quote = await session.get(DealQuote, payload.quote_id)
    if quote is None or quote.dealer_id != profile.id:
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "Quote not found.", 404)
    if payload.document_type not in {"vehicle_image", "quote_document"}:
        raise AppError(error_codes.VALIDATION_ERROR, "Choose vehicle_image or quote_document.", 422)
    allowed_images = {"image/jpeg", "image/png", "image/webp"}
    allowed_documents = {
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }
    allowed = allowed_images if payload.document_type == "vehicle_image" else allowed_documents
    if payload.content_type.lower() not in allowed:
        label = "JPG, PNG, or WebP" if payload.document_type == "vehicle_image" else "PDF, DOC, or DOCX"
        raise AppError(error_codes.VALIDATION_ERROR, f"Unsupported file type. Upload {label}.", 422)
    limit = 12 * 1024 * 1024 if payload.document_type == "vehicle_image" else 20 * 1024 * 1024
    if payload.size_bytes is not None and payload.size_bytes > limit:
        raise AppError(
            error_codes.VALIDATION_ERROR, f"File is too large. The limit is {limit // 1024 // 1024} MB.", 422
        )
    existing = int(
        (
            await session.execute(
                select(func.count(DealDocument.id)).where(
                    DealDocument.quote_id == payload.quote_id, DealDocument.document_type == payload.document_type
                )
            )
        ).scalar_one()
    )
    if payload.document_type == "vehicle_image" and existing >= 8:
        raise AppError(error_codes.CONFLICT, "A quote can include up to 8 vehicle photos.", 409)
    if payload.document_type == "quote_document" and existing >= 1:
        raise AppError(
            error_codes.CONFLICT, "A quote can include one document. Remove it before uploading another.", 409
        )
    original_name = Path(payload.filename).name
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", original_name).strip("-.") or "attachment"
    key = f"deals/{payload.quote_id}/{profile.id}/{uuid4()}--{safe_name}"
    return get_storage().create_upload(key, payload.content_type)


@router.post("/{document_id}/confirm")
@log_flow(layer="route")
async def confirm(
    document_id: str,
    payload: ConfirmUploadRequest,
    profile: Profile = Depends(require_roles("dealer")),
    session: AsyncSession = Depends(get_session),
):
    quote = await session.get(DealQuote, payload.quote_id)
    if quote is None or quote.dealer_id != profile.id:
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "Deal not found.", 404)
    normalized_type = "vehicle_image" if payload.document_type == "vehicle_image" else "quote_document"
    if payload.document_type not in {"vehicle_image", "quote_document", "buyer_order", "window_sticker"}:
        raise AppError(error_codes.VALIDATION_ERROR, "Unsupported quote attachment type.", 422)
    expected_prefix = f"deals/{payload.quote_id}/{profile.id}/"
    if not payload.object_key.startswith(expected_prefix):
        raise AppError(error_codes.VALIDATION_ERROR, "The uploaded object does not belong to this quote.", 422)
    existing_query = select(func.count(DealDocument.id)).where(
        DealDocument.quote_id == payload.quote_id, DealDocument.id != document_id
    )
    if normalized_type == "vehicle_image":
        existing_query = existing_query.where(DealDocument.document_type == "vehicle_image")
        if int((await session.execute(existing_query)).scalar_one()) >= 8:
            raise AppError(error_codes.CONFLICT, "A quote can include up to 8 vehicle photos.", 409)
    else:
        existing_query = existing_query.where(DealDocument.document_type != "vehicle_image")
        if int((await session.execute(existing_query)).scalar_one()) >= 1:
            raise AppError(
                error_codes.CONFLICT, "A quote can include one document. Remove it before uploading another.", 409
            )
    row = await session.get(DealDocument, document_id)
    if row is None:
        row = DealDocument(
            id=document_id,
            quote_id=payload.quote_id,
            dealer_id=profile.id,
            document_type=normalized_type,
            document_path=payload.object_key,
            status="confirmed",
        )
        session.add(row)
    else:
        row.document_path = payload.object_key
        row.status = "confirmed"
    await session.commit()
    await session.refresh(row)
    logger.info(
        "upload_confirmed",
        document_id=document_id,
        quote_id=payload.quote_id,
        dealer_id=profile.id,
        document_type=payload.document_type,
    )
    return model_dict(row)


@router.get("/{quote_id}")
@log_flow(layer="route")
async def list_documents(
    quote_id: str, profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)
):
    quote = await session.get(DealQuote, quote_id)
    if quote is None or (
        profile.role not in {"support", "support-admin", "admin"}
        and profile.id not in {quote.buyer_id, quote.dealer_id}
    ):
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "Deal not found.", 404)
    rows = (await session.execute(select(DealDocument).where(DealDocument.quote_id == quote_id))).scalars()
    storage = get_storage()
    result = []
    for row in rows:
        if not row.document_path or row.status != "confirmed":
            continue
        stored_name = row.document_path.rsplit("/", 1)[-1]
        display_name = stored_name.split("--", 1)[-1] if "--" in stored_name else stored_name
        is_image = row.document_type == "vehicle_image"
        result.append(
            {
                **model_dict(row),
                "file_name": display_name,
                "download_url": storage.create_download(
                    row.document_path, as_attachment=not is_image, filename=display_name
                ),
            }
        )
    return result


@router.delete("/{quote_id}/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
@log_flow(layer="route")
async def delete_document(
    quote_id: str,
    document_id: str,
    profile: Profile = Depends(require_roles("dealer")),
    session: AsyncSession = Depends(get_session),
) -> Response:
    row = await session.get(DealDocument, document_id)
    if row is None or row.quote_id != quote_id or row.dealer_id != profile.id:
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "Document not found.", 404)
    await session.delete(row)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
