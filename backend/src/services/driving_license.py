import re
from dataclasses import dataclass, field
from pathlib import PurePath

from fastapi import UploadFile

from src.settings import (
    BUYER_STORAGE_PREFIX,
    DRIVING_LICENSE_EXTENSIONS,
    DRIVING_LICENSE_FOLDER,
    DRIVING_LICENSE_MAX_BYTES,
    PERSONAL_DETAILS_FOLDER,
)
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow

ACCEPTED_FORMATS_LABEL = "JPG, PNG, WebP, or PDF"
MAX_FILE_NAME_LENGTH = 255


@dataclass(frozen=True)
class DrivingLicenseUpload:
    """A validated driving-licence file. ``content`` is kept out of ``repr`` so flow logging never renders it."""

    content: bytes = field(repr=False)
    content_type: str
    file_name: str

    @property
    def size_bytes(self) -> int:
        return len(self.content)

    @property
    def extension(self) -> str:
        return DRIVING_LICENSE_EXTENSIONS[self.content_type]


def driving_license_key(profile_id: str, extension: str) -> str:
    """The object key for a buyer's licence: ``buyer/<profile id>/personal-details/driving-licence/driving-licence<ext>``."""
    return (
        f"{BUYER_STORAGE_PREFIX}/{profile_id}/{PERSONAL_DETAILS_FOLDER}/"
        f"{DRIVING_LICENSE_FOLDER}/{DRIVING_LICENSE_FOLDER}{extension}"
    )


def sniff_content_type(content: bytes) -> str | None:
    """Identifies the file from its signature, so a renamed or mislabelled upload is not trusted."""
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if content.startswith(b"%PDF-"):
        return "application/pdf"
    return None


def display_file_name(raw: str | None, extension: str) -> str:
    """The client's file name reduced to a safe display label (no path, no control characters)."""
    name = PurePath((raw or "").replace("\\", "/")).name
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()
    return (name or f"driving-licence{extension}")[:MAX_FILE_NAME_LENGTH]


@log_flow(layer="service")
async def read_driving_license(upload: UploadFile | None) -> DrivingLicenseUpload:
    if upload is None or not upload.filename:
        raise AppError(
            error_codes.VALIDATION_ERROR,
            f"Upload a photo or PDF of your driving licence ({ACCEPTED_FORMATS_LABEL}).",
            422,
        )
    # One byte past the limit is enough to know the file is too large without buffering all of it.
    content = await upload.read(DRIVING_LICENSE_MAX_BYTES + 1)
    if not content:
        raise AppError(error_codes.VALIDATION_ERROR, "The driving licence file is empty.", 422)
    if len(content) > DRIVING_LICENSE_MAX_BYTES:
        raise AppError(
            error_codes.VALIDATION_ERROR,
            f"The driving licence file is too large. The limit is {DRIVING_LICENSE_MAX_BYTES // 1024 // 1024} MB.",
            422,
        )
    content_type = sniff_content_type(content)
    if content_type is None:
        raise AppError(
            error_codes.VALIDATION_ERROR,
            f"Unsupported driving licence file. Upload a {ACCEPTED_FORMATS_LABEL} file.",
            422,
        )
    return DrivingLicenseUpload(
        content=content,
        content_type=content_type,
        file_name=display_file_name(upload.filename, DRIVING_LICENSE_EXTENSIONS[content_type]),
    )
