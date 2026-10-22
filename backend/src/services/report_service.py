"""Misconduct reports: a buyer or dealer reporting the other person in one of their conversations.

The reported person is never chosen by the client. It is the other party on the quote the conversation belongs to,
so a report can only name someone the reporter actually dealt with.
"""

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime
from secrets import token_hex
from time import time

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.marketplace import (
    BUYER_REPORT_REASONS,
    DEALER_REPORT_REASONS,
    ReportCreate,
    ReportUpdate,
)
from src.repositories.marketplace_repository import MarketplaceRepository
from src.repositories.schema import Brand, BuyerRequest, DealQuote, Profile, User, UserReport, UserReportAttachment
from src.services.driving_license import display_file_name, sniff_content_type
from src.services.marketplace_service import CHAT_UNSENT_MARKER, CHAT_UNSENT_TEXT, MarketplaceService
from src.services.storage import Storage, StorageError, StorageObject, get_storage
from src.settings import (
    REPORT_EVIDENCE_EXTENSIONS,
    REPORT_EVIDENCE_MAX_BYTES,
    REPORT_EVIDENCE_MAX_FILES,
    REPORTS_PREFIX,
)
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow
from src.utils.logger import logger
from src.utils.serialization import model_dict

SUPPORT_ROLES = {"support", "support-admin", "admin"}
ACTIVE_STATUSES = {"open", "under_review"}
CLOSED_STATUSES = {"action_taken", "dismissed"}
# The newest messages are what the report is about; a very long thread is cut to these.
SNAPSHOT_MAX_MESSAGES = 200


@dataclass(frozen=True)
class ReportUpload:
    """A validated screenshot. ``content`` is kept out of ``repr`` so flow logging never renders it."""

    content: bytes = field(repr=False)
    content_type: str
    file_name: str

    @property
    def extension(self) -> str:
        return REPORT_EVIDENCE_EXTENSIONS[self.content_type]


def report_evidence_key(reported_role: str, reported_id: str, report_id: str, index: int, extension: str) -> str:
    """``reports/<buyer|dealer>/<reported profile id>/RPT-…/RPT-…-evidence-01.png``."""
    return f"{REPORTS_PREFIX}/{reported_role}/{reported_id}/{report_id}/{report_id}-evidence-{index:02d}{extension}"


@log_flow(layer="service")
async def read_report_uploads(uploads: list[UploadFile]) -> list[ReportUpload]:
    """Checks every screenshot before any is stored: count, size, and the real type from the file's own signature."""
    uploads = [upload for upload in uploads if upload.filename]
    if len(uploads) > REPORT_EVIDENCE_MAX_FILES:
        raise AppError(
            error_codes.VALIDATION_ERROR, f"A report can have up to {REPORT_EVIDENCE_MAX_FILES} screenshots.", 422
        )
    files: list[ReportUpload] = []
    for upload in uploads:
        # One byte past the limit is enough to know the file is too large without buffering all of it.
        content = await upload.read(REPORT_EVIDENCE_MAX_BYTES + 1)
        if not content:
            raise AppError(error_codes.VALIDATION_ERROR, f"{upload.filename} is empty.", 422)
        if len(content) > REPORT_EVIDENCE_MAX_BYTES:
            limit = REPORT_EVIDENCE_MAX_BYTES // 1024 // 1024
            raise AppError(error_codes.VALIDATION_ERROR, f"{upload.filename} is over {limit} MB.", 422)
        content_type = sniff_content_type(content)
        if content_type not in REPORT_EVIDENCE_EXTENSIONS:
            raise AppError(error_codes.VALIDATION_ERROR, f"{upload.filename} is not a JPG, PNG or WebP image.", 422)
        extension = REPORT_EVIDENCE_EXTENSIONS[content_type]
        files.append(
            ReportUpload(
                content=content, content_type=content_type, file_name=display_file_name(upload.filename, extension)
            )
        )
    return files


class ReportService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # Reporting

    @log_flow(layer="service")
    async def create_report(self, payload: ReportCreate, uploads: list[ReportUpload], reporter: Profile) -> dict:
        quote = await self.session.get(DealQuote, payload.quote_id)
        if quote is None or reporter.id not in {quote.buyer_id, quote.dealer_id}:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Conversation not found.", 404)
        reported_id = quote.dealer_id if reporter.id == quote.buyer_id else quote.buyer_id
        reported = await self.session.get(Profile, reported_id)
        if reported is None:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Conversation not found.", 404)
        allowed = DEALER_REPORT_REASONS if reported.role == "dealer" else BUYER_REPORT_REASONS
        if payload.reason not in allowed:
            raise AppError(error_codes.VALIDATION_ERROR, f"That reason does not apply to a {reported.role}.", 422)
        open_report = (
            await self.session.execute(
                select(UserReport).where(
                    UserReport.reporter_id == reporter.id,
                    UserReport.quote_id == quote.id,
                    UserReport.status.in_(ACTIVE_STATUSES),
                )
            )
        ).scalar_one_or_none()
        if open_report is not None:
            raise AppError(
                error_codes.CONFLICT,
                f"You already reported this conversation and our team is reviewing it ({open_report.report_id}).",
                409,
                details={"report_id": open_report.report_id},
            )

        snapshot = await self._conversation_snapshot(quote) if payload.include_conversation else None
        report = UserReport(
            # The random tail keeps two reports sent in the same second from colliding.
            report_id=f"RPT-{str(int(time()))[-6:]}{token_hex(2).upper()}",
            quote_id=quote.id,
            reporter_id=reporter.id,
            reporter_role=reporter.role,
            reported_id=reported.id,
            reported_role=reported.role,
            reason=payload.reason,
            details=payload.details,
            conversation_snapshot=snapshot,
            notes=[],
            created_by=reporter.id,
            updated_by=reporter.id,
        )
        self.session.add(report)
        storage = get_storage()
        stored: list[str] = []
        try:
            await self.session.flush()
            for index, upload in enumerate(uploads, start=1):
                key = report_evidence_key(reported.role, reported.id, report.report_id, index, upload.extension)
                # boto3 is blocking, so the upload runs off the event loop.
                await asyncio.to_thread(
                    storage.put_object, StorageObject(key=key, content=upload.content, content_type=upload.content_type)
                )
                stored.append(key)
                self.session.add(
                    UserReportAttachment(
                        report_id=report.id,
                        object_key=key,
                        file_name=upload.file_name,
                        content_type=upload.content_type,
                        size_bytes=len(upload.content),
                        created_by=reporter.id,
                        updated_by=reporter.id,
                    )
                )
            await self.session.commit()
        except StorageError as exc:
            await self.session.rollback()
            await self._discard(storage, stored)
            logger.error("report_evidence_upload_failed", reporter_id=reporter.id, error=str(exc))
            raise AppError(
                error_codes.STORAGE_UNAVAILABLE, "We could not store your screenshots right now. Please try again.", 503
            ) from exc
        except Exception:
            await self.session.rollback()
            await self._discard(storage, stored)
            raise
        await self.session.refresh(report)
        logger.info(
            "user_reported",
            report_id=report.report_id,
            reporter_id=reporter.id,
            reported_id=reported.id,
            reason=report.reason,
            evidence_count=len(uploads),
        )
        # The reporter gets a receipt only; support notes and the outcome stay internal.
        return {
            "id": report.id,
            "report_id": report.report_id,
            "status": report.status,
            "reason": report.reason,
            "reported_role": report.reported_role,
            "evidence_count": len(uploads),
            "conversation_attached": snapshot is not None,
            "created_at": report.created_at.isoformat(),
        }

    async def _conversation_snapshot(self, quote: DealQuote) -> list[dict]:
        """Every message in the thread as it stands now, including ones a party hid from their own view."""
        rows = (await MarketplaceRepository(self.session).chat_messages(quote.id))[-SNAPSHOT_MAX_MESSAGES:]
        senders = await self._profile_map({row.sender_id for row in rows})
        snapshot = []
        for row in rows:
            sender = senders.get(row.sender_id)
            unsent = row.message == CHAT_UNSENT_MARKER
            snapshot.append(
                {
                    "id": row.id,
                    "at": row.created_at.isoformat() if row.created_at else None,
                    "sender_id": row.sender_id,
                    "sender_name": MarketplaceService._chat_sender_name(sender),
                    "sender_role": sender.role if sender else None,
                    "message": CHAT_UNSENT_TEXT if unsent else row.message,
                    "edited": row.updated_by == row.sender_id and not unsent,
                    "unsent": unsent,
                }
            )
        return snapshot

    @staticmethod
    async def _discard(storage: Storage, keys: list[str]) -> None:
        for key in keys:
            try:
                await asyncio.to_thread(storage.delete_object, key)
            except StorageError as exc:
                logger.warning("report_evidence_cleanup_failed", object_key=key, error=str(exc))

    # Support review

    @log_flow(layer="service")
    async def list_reports(self) -> list[dict]:
        rows = list((await self.session.execute(select(UserReport).order_by(UserReport.created_at.desc()))).scalars())
        return await self._report_dicts(rows, detail=False)

    @log_flow(layer="service")
    async def get_report(self, report_id: str) -> dict:
        [report] = await self._report_dicts([await self._report(report_id)], detail=True)
        return report

    @log_flow(layer="service")
    async def update_report(self, report_id: str, payload: ReportUpdate, actor: Profile) -> dict:
        report = await self._report(report_id)
        note = (payload.note or "").strip() or None
        status = payload.status or report.status
        outcome = payload.outcome if payload.outcome is not None else report.outcome
        if status in CLOSED_STATUSES:
            if status == "dismissed":
                if payload.outcome not in {None, "no_violation"}:
                    raise AppError(error_codes.VALIDATION_ERROR, "A dismissed report's outcome is no violation.", 422)
                outcome = "no_violation"
            elif outcome in {None, "no_violation"}:
                raise AppError(
                    error_codes.VALIDATION_ERROR,
                    "Choose the action taken: warning issued, account suspended, or other.",
                    422,
                )
            if report.status not in CLOSED_STATUSES and not note:
                raise AppError(error_codes.VALIDATION_ERROR, "Add a decision note before closing the report.", 422)
        else:
            if payload.outcome is not None:
                raise AppError(error_codes.VALIDATION_ERROR, "Set an outcome only when closing a report.", 422)
            outcome = None

        entry: dict = {"at": datetime.now(UTC).isoformat(), "actor_id": actor.id}
        if status != report.status:
            entry["status"] = status
        if outcome != report.outcome and outcome is not None:
            entry["outcome"] = outcome
        if note:
            entry["note"] = note
        if len(entry) == 2:
            raise AppError(error_codes.VALIDATION_ERROR, "Change the status, outcome, or add a note.", 422)
        report.status = status
        report.outcome = outcome
        report.notes = [*report.notes, entry]
        report.updated_by = actor.id
        await self.session.commit()
        await self.session.refresh(report)
        logger.info("report_updated", report_id=report.report_id, actor_id=actor.id, status=status, outcome=outcome)
        return await self.get_report(report.id)

    @log_flow(layer="service")
    async def attachment_link(self, report_id: str, attachment_id: str) -> dict:
        """A short-lived link that opens the screenshot in the browser, for support staff only."""
        report = await self._report(report_id)
        attachment = await self.session.get(UserReportAttachment, attachment_id)
        if attachment is None or attachment.report_id != report.id:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Attachment not found.", 404)
        return {
            "url": get_storage().create_download(attachment.object_key),
            "file_name": attachment.file_name,
            "content_type": attachment.content_type,
        }

    # Helpers

    async def _report(self, report_id: str) -> UserReport:
        report = await self.session.get(UserReport, report_id)
        if report is None:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Report not found.", 404)
        return report

    async def _profile_map(self, profile_ids: set[str]) -> dict[str, Profile]:
        if not profile_ids:
            return {}
        rows = (await self.session.execute(select(Profile).where(Profile.id.in_(profile_ids)))).scalars()
        return {row.id: row for row in rows}

    async def _report_dicts(self, rows: list[UserReport], *, detail: bool) -> list[dict]:
        actor_ids = {note["actor_id"] for row in rows for note in row.notes if note.get("actor_id")}
        profiles = await self._profile_map({*actor_ids, *(r.reporter_id for r in rows), *(r.reported_id for r in rows)})
        active = {
            user.profile_id: user.is_active
            for user in (
                await self.session.execute(select(User).where(User.profile_id.in_({row.reported_id for row in rows})))
            ).scalars()
        }
        vehicles = await self._vehicle_map({row.quote_id for row in rows})
        attachments = await self._attachment_map([row.id for row in rows])

        def person(profile_id: str) -> dict:
            profile = profiles.get(profile_id)
            return {
                "id": profile_id,
                "name": profile.full_name if profile else None,
                "dealership_name": profile.dealership_name if profile else None,
                "email": profile.email if profile else None,
                "phone": profile.phone if profile else None,
                "role": profile.role if profile else None,
            }

        result = []
        for row in rows:
            data = {key: value for key, value in model_dict(row).items() if key != "conversation_snapshot"}
            snapshot = row.conversation_snapshot
            result.append(
                {
                    **data,
                    "notes": [
                        {**note, "actor_name": profiles[note["actor_id"]].full_name}
                        if note.get("actor_id") in profiles
                        else note
                        for note in row.notes
                    ],
                    "reporter": person(row.reporter_id),
                    "reported": {**person(row.reported_id), "is_active": active.get(row.reported_id, True)},
                    "vehicle": vehicles.get(row.quote_id),
                    "attachments": attachments.get(row.id, []),
                    "conversation_attached": snapshot is not None,
                    "message_count": len(snapshot or []),
                    **({"conversation_snapshot": snapshot} if detail else {}),
                }
            )
        return result

    async def _vehicle_map(self, quote_ids: set[str]) -> dict[str, str]:
        if not quote_ids:
            return {}
        rows = await self.session.execute(
            select(DealQuote.id, Brand.name, BuyerRequest.model)
            .join(BuyerRequest, BuyerRequest.id == DealQuote.buyer_request_id)
            .join(Brand, Brand.id == BuyerRequest.brand_id)
            .where(DealQuote.id.in_(quote_ids))
        )
        return {quote_id: f"{brand} {model}" for quote_id, brand, model in rows}

    async def _attachment_map(self, report_ids: list[str]) -> dict[str, list[dict]]:
        """Each report's screenshots as display metadata. Storage keys stay server-side; viewing goes through a link."""
        if not report_ids:
            return {}
        rows = (
            await self.session.execute(
                select(UserReportAttachment)
                .where(UserReportAttachment.report_id.in_(report_ids))
                .order_by(UserReportAttachment.created_at)
            )
        ).scalars()
        result: dict[str, list[dict]] = {}
        for row in rows:
            result.setdefault(row.report_id, []).append(
                {
                    "id": row.id,
                    "file_name": row.file_name,
                    "content_type": row.content_type,
                    "size_bytes": row.size_bytes,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
            )
        return result
