from dataclasses import dataclass, field

from fastapi import UploadFile

from src.services.driving_license import display_file_name, sniff_content_type
from src.settings import (
    DEALER_DOCUMENTS_FOLDER,
    DEALER_LICENSE_FILE_STEM,
    DEALER_LICENSE_MAX_BYTES,
    DEALER_STORAGE_PREFIX,
    PERSONAL_DETAILS_FOLDER,
)
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow

DOCUMENT_LABEL = "Motor Vehicle Dealer License"
PDF_CONTENT_TYPE = "application/pdf"
PDF_EXTENSION = ".pdf"


@dataclass(frozen=True)
class DealerLicenseUpload:
    """A validated dealer licence PDF. ``content`` is kept out of ``repr`` so flow logging never renders it."""

    content: bytes = field(repr=False)
    file_name: str
    content_type: str = PDF_CONTENT_TYPE

    @property
    def size_bytes(self) -> int:
        return len(self.content)


def dealer_license_key(profile_id: str) -> str:
    """``dealer/<dealer id>/personal-details/dealer-documents/motor-vehicle-dealer-license.pdf``."""
    return (
        f"{DEALER_STORAGE_PREFIX}/{profile_id}/{PERSONAL_DETAILS_FOLDER}/"
        f"{DEALER_DOCUMENTS_FOLDER}/{DEALER_LICENSE_FILE_STEM}{PDF_EXTENSION}"
    )


@log_flow(layer="service")
async def read_dealer_license(upload: UploadFile | None) -> DealerLicenseUpload:
    if upload is None or not upload.filename:
        raise AppError(error_codes.VALIDATION_ERROR, f"Upload your {DOCUMENT_LABEL} as a PDF.", 422)
    # One byte past the limit is enough to know the file is too large without buffering all of it.
    content = await upload.read(DEALER_LICENSE_MAX_BYTES + 1)
    if not content:
        raise AppError(error_codes.VALIDATION_ERROR, f"The {DOCUMENT_LABEL} file is empty.", 422)
    if len(content) > DEALER_LICENSE_MAX_BYTES:
        raise AppError(
            error_codes.VALIDATION_ERROR,
            f"The {DOCUMENT_LABEL} file is too large. The limit is {DEALER_LICENSE_MAX_BYTES // 1024 // 1024} MB.",
            422,
        )
    # The file's own signature decides, so a renamed image or a mislabelled upload is not accepted as a PDF.
    if sniff_content_type(content) != PDF_CONTENT_TYPE:
        raise AppError(error_codes.VALIDATION_ERROR, f"The {DOCUMENT_LABEL} must be a PDF file.", 422)
    return DealerLicenseUpload(content=content, file_name=display_file_name(upload.filename, PDF_EXTENSION))
