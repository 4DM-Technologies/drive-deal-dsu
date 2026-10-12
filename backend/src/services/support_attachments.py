from dataclasses import dataclass, field

from fastapi import UploadFile

from src.services.driving_license import display_file_name, sniff_content_type
from src.settings import (
    DRIVING_LICENSE_EXTENSIONS,
    HELP_SUPPORT_FOLDERS,
    HELP_SUPPORT_PREFIX,
    HELP_SUPPORT_STAFF_FOLDER,
    SUPPORT_ATTACHMENT_MAX_BYTES,
    SUPPORT_ATTACHMENT_MAX_FILES,
)
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow

ACCEPTED_FORMATS_LABEL = "JPG, PNG, WebP or PDF"


@dataclass(frozen=True)
class SupportUpload:
    """A validated support attachment. ``content`` is kept out of ``repr`` so flow logging never renders it."""

    content: bytes = field(repr=False)
    content_type: str
    file_name: str

    @property
    def extension(self) -> str:
        return DRIVING_LICENSE_EXTENSIONS[self.content_type]


def support_attachment_key(role: str, profile_id: str, ticket_id: str, index: int, extension: str) -> str:
    """``help-support/<buyer-support|dealer-support>/<profile id>/<ticket id>/attachment-01.png``."""
    folder = HELP_SUPPORT_FOLDERS.get(role, HELP_SUPPORT_STAFF_FOLDER)
    return f"{HELP_SUPPORT_PREFIX}/{folder}/{profile_id}/{ticket_id}/attachment-{index:02d}{extension}"


@log_flow(layer="service")
async def read_support_uploads(uploads: list[UploadFile], already_attached: int) -> list[SupportUpload]:
    """Checks every file before any is stored: count, size, and the real type from the file's own signature."""
    uploads = [upload for upload in uploads if upload.filename]
    if not uploads:
        raise AppError(
            error_codes.VALIDATION_ERROR, f"Choose a screenshot or PDF to attach ({ACCEPTED_FORMATS_LABEL}).", 422
        )
    if already_attached + len(uploads) > SUPPORT_ATTACHMENT_MAX_FILES:
        raise AppError(
            error_codes.VALIDATION_ERROR, f"A ticket can have up to {SUPPORT_ATTACHMENT_MAX_FILES} attachments.", 422
        )
    files: list[SupportUpload] = []
    for upload in uploads:
        # One byte past the limit is enough to know the file is too large without buffering all of it.
        content = await upload.read(SUPPORT_ATTACHMENT_MAX_BYTES + 1)
        if not content:
            raise AppError(error_codes.VALIDATION_ERROR, f"{upload.filename} is empty.", 422)
        if len(content) > SUPPORT_ATTACHMENT_MAX_BYTES:
            limit = SUPPORT_ATTACHMENT_MAX_BYTES // 1024 // 1024
            raise AppError(error_codes.VALIDATION_ERROR, f"{upload.filename} is over {limit} MB.", 422)
        content_type = sniff_content_type(content)
        if content_type is None:
            raise AppError(
                error_codes.VALIDATION_ERROR, f"{upload.filename} is not a {ACCEPTED_FORMATS_LABEL} file.", 422
            )
        extension = DRIVING_LICENSE_EXTENSIONS[content_type]
        files.append(
            SupportUpload(
                content=content, content_type=content_type, file_name=display_file_name(upload.filename, extension)
            )
        )
    return files
