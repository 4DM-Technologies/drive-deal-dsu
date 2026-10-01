from uuid import uuid4

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.middleware.auth import get_current_profile, require_roles
from src.repositories.schema import DealDocument, DealQuote, Profile
from src.services.storage import get_storage
from src.settings import UPLOAD_DIRECTORY
from src.utils.exceptions import AppError, error_codes
from src.utils.serialization import model_dict

router = APIRouter(prefix="/documents", tags=["Documents"])


def _local_path(key: str):
    resolved = (UPLOAD_DIRECTORY / key).resolve()
    if UPLOAD_DIRECTORY.resolve() not in resolved.parents:
        raise AppError(error_codes.VALIDATION_ERROR, "Invalid storage key.", 400)
    return resolved


@router.put("/local/{key:path}", status_code=status.HTTP_204_NO_CONTENT)
async def upload_local(key: str, request: Request) -> Response:
    path = _local_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(await request.body())
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/local/{key:path}")
async def download_local(key: str):
    path = _local_path(key)
    if not path.is_file():
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "File not found.", 404)
    return FileResponse(path)


class PresignRequest(BaseModel):
    filename: str
    content_type: str
    quote_id: str


class ConfirmUploadRequest(BaseModel):
    quote_id: str
    document_type: str
    object_key: str


@router.post("/presign")
async def presign(payload: PresignRequest, profile: Profile = Depends(require_roles("dealer"))):
    extension = payload.filename.rsplit(".", 1)[-1].lower() if "." in payload.filename else "bin"
    key = f"deals/{payload.quote_id}/{profile.id}/{uuid4()}.{extension}"
    return get_storage().create_upload(key, payload.content_type)


@router.post("/{document_id}/confirm")
async def confirm(document_id: str, payload: ConfirmUploadRequest, profile: Profile = Depends(require_roles("dealer")), session: AsyncSession = Depends(get_session)):
    quote = await session.get(DealQuote, payload.quote_id)
    if quote is None or quote.dealer_id != profile.id:
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "Deal not found.", 404)
    row = await session.get(DealDocument, document_id)
    if row is None:
        row = DealDocument(id=document_id, quote_id=payload.quote_id, dealer_id=profile.id, document_type=payload.document_type, document_path=payload.object_key, status="confirmed")
        session.add(row)
    else:
        row.document_path = payload.object_key
        row.status = "confirmed"
    await session.commit()
    await session.refresh(row)
    return model_dict(row)


@router.get("/{quote_id}")
async def list_documents(quote_id: str, profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    quote = await session.get(DealQuote, quote_id)
    if quote is None or (profile.role not in {"support", "support-admin", "admin"} and profile.id not in {quote.buyer_id, quote.dealer_id}):
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "Deal not found.", 404)
    rows = (await session.execute(select(DealDocument).where(DealDocument.quote_id == quote_id))).scalars()
    storage = get_storage()
    return [{**model_dict(row), "download_url": storage.create_download(row.document_path)} for row in rows]


@router.delete("/{quote_id}/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(quote_id: str, document_id: str, profile: Profile = Depends(require_roles("dealer")), session: AsyncSession = Depends(get_session)) -> Response:
    row = await session.get(DealDocument, document_id)
    if row is None or row.quote_id != quote_id or row.dealer_id != profile.id:
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "Document not found.", 404)
    await session.delete(row)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
