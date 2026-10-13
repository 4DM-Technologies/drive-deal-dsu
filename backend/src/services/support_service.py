import asyncio
from datetime import UTC, datetime
from secrets import token_hex
from time import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.marketplace import TicketCreate, TicketUpdate, VerificationDecision
from src.repositories.schema import (
    DealerDocument,
    Profile,
    State,
    SupportTicket,
    SupportTicketAttachment,
    SupportVerification,
    User,
)
from src.services.dealer_license import DOCUMENT_LABEL as DEALER_LICENSE_LABEL
from src.services.storage import Storage, StorageError, StorageObject, get_storage
from src.services.support_attachments import SupportUpload, support_attachment_key
from src.settings import DEALER_LICENSE_DOCUMENT_TYPE
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow
from src.utils.logger import logger
from src.utils.serialization import model_dict

DOCUMENT_LABELS = {DEALER_LICENSE_DOCUMENT_TYPE: DEALER_LICENSE_LABEL}


class SupportService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @log_flow(layer="service")
    async def _ticket_dict(self, row: SupportTicket) -> dict:
        caller = await self.session.get(Profile, row.caller_id)
        attachments = await self._attachment_map([row.id])
        return {
            **model_dict(row),
            "caller_name": caller.full_name if caller else None,
            "caller_email": caller.email if caller else None,
            "caller_role": caller.role if caller else None,
            "attachments": attachments.get(row.id, []),
        }

    async def _attachment_map(self, ticket_ids: list[str]) -> dict[str, list[dict]]:
        """Each ticket's attachments as display metadata. Storage keys stay server-side; downloads go through a link."""
        if not ticket_ids:
            return {}
        rows = (
            await self.session.execute(
                select(SupportTicketAttachment)
                .where(SupportTicketAttachment.ticket_id.in_(ticket_ids))
                .order_by(SupportTicketAttachment.created_at)
            )
        ).scalars()
        result: dict[str, list[dict]] = {}
        for row in rows:
            result.setdefault(row.ticket_id, []).append(
                {
                    "id": row.id,
                    "file_name": row.file_name,
                    "content_type": row.content_type,
                    "size_bytes": row.size_bytes,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
            )
        return result

    @log_flow(layer="service")
    async def _verification_dict(self, row: SupportVerification) -> dict:
        profile = await self.session.get(Profile, row.profile_id)
        state = await self.session.get(State, profile.state_id) if profile and profile.state_id else None
        decider = await self.session.get(Profile, row.decided_by) if row.decided_by else None
        documents = await self._dealer_document_map({row.profile_id})
        return self._verification_payload(row, profile, state, decider, documents.get(row.profile_id, []))

    async def _dealer_document_map(self, profile_ids: set[str]) -> dict[str, list[dict]]:
        """Each applicant's signup documents as display metadata. Keys stay server-side; viewing goes through a link."""
        if not profile_ids:
            return {}
        rows = (
            await self.session.execute(
                select(DealerDocument)
                .where(DealerDocument.profile_id.in_(profile_ids))
                .order_by(DealerDocument.created_at)
            )
        ).scalars()
        result: dict[str, list[dict]] = {}
        for row in rows:
            result.setdefault(row.profile_id, []).append(
                {
                    "id": row.id,
                    "document_type": row.document_type,
                    "label": DOCUMENT_LABELS.get(row.document_type, "Supporting document"),
                    "file_name": row.file_name,
                    "content_type": row.content_type,
                    "size_bytes": row.size_bytes,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
            )
        return result

    @staticmethod
    def _verification_payload(
        row: SupportVerification,
        profile: Profile | None,
        state: State | None,
        decider: Profile | None,
        documents: list[dict] | None = None,
    ) -> dict:
        return {
            **model_dict(row),
            "documents": documents or [],
            "profile_name": profile.full_name if profile else None,
            "business_name": profile.dealership_name if profile else None,
            "state": state.name if state else None,
            "state_code": state.code if state else None,
            "email": profile.email if profile else None,
            "phone": profile.phone if profile else None,
            "address": profile.address if profile else None,
            "role": profile.role if profile else None,
            "branch_name": profile.branch_name if profile else None,
            "dealer_license": profile.dealer_license if profile else None,
            "website": profile.website if profile else None,
            "supported_brands": profile.supported_brands if profile else [],
            "terms_accepted": profile.terms_accepted if profile else False,
            "terms_version": profile.terms_version if profile else None,
            "terms_accepted_at": profile.terms_accepted_at.isoformat()
            if profile and profile.terms_accepted_at
            else None,
            "decided_by_name": decider.full_name if decider else None,
        }

    @log_flow(layer="service")
    async def _profile_map(self, profile_ids: set[str]) -> dict[str, Profile]:
        if not profile_ids:
            return {}
        rows = (await self.session.execute(select(Profile).where(Profile.id.in_(profile_ids)))).scalars()
        return {row.id: row for row in rows}

    @log_flow(layer="service")
    async def list_tickets(self, actor: Profile, queue: bool = False) -> list[dict]:
        statement = select(SupportTicket).order_by(SupportTicket.created_at.desc())
        if not queue or actor.role not in {"support", "support-admin", "admin"}:
            statement = statement.where(SupportTicket.caller_id == actor.id)
        rows = list((await self.session.execute(statement)).scalars())
        callers = await self._profile_map({row.caller_id for row in rows})
        attachments = await self._attachment_map([row.id for row in rows])
        return [
            {
                **model_dict(row),
                "caller_name": callers[row.caller_id].full_name if row.caller_id in callers else None,
                "caller_email": callers[row.caller_id].email if row.caller_id in callers else None,
                "caller_role": callers[row.caller_id].role if row.caller_id in callers else None,
                "attachments": attachments.get(row.id, []),
            }
            for row in rows
        ]

    @log_flow(layer="service")
    async def create_ticket(self, payload: TicketCreate, actor: Profile) -> dict:
        category = "dealer" if actor.role == "dealer" else "customer"
        prefix = "DS" if category == "dealer" else "TIC-"
        ticket = SupportTicket(
            # The random tail keeps two reports sent in the same second from colliding.
            ticket_id=f"{prefix}{str(int(time()))[-6:]}{token_hex(2).upper()}",
            category=category,
            caller_id=actor.id,
            **payload.model_dump(),
        )
        self.session.add(ticket)
        await self.session.commit()
        await self.session.refresh(ticket)
        logger.info("ticket_created", ticket_id=ticket.ticket_id, caller_id=actor.id, category=category)
        return await self._ticket_dict(ticket)

    @log_flow(layer="service")
    async def add_attachments(self, ticket_id: str, uploads: list[SupportUpload], actor: Profile) -> dict:
        """Stores the requester's screenshots or PDFs under help-support/... and records them on the ticket."""
        ticket = await self.session.get(SupportTicket, ticket_id)
        if ticket is None or ticket.caller_id != actor.id:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Ticket not found.", 404)
        existing = len((await self._attachment_map([ticket.id])).get(ticket.id, []))
        # Read before any rollback below, which expires the loaded ticket.
        ticket_uuid, public_id = ticket.id, ticket.ticket_id
        storage = get_storage()
        stored: list[str] = []
        try:
            for offset, upload in enumerate(uploads, start=1):
                key = support_attachment_key(actor.role, actor.id, public_id, existing + offset, upload.extension)
                item = StorageObject(key=key, content=upload.content, content_type=upload.content_type)
                # boto3 is blocking, so the upload runs off the event loop.
                await asyncio.to_thread(storage.put_object, item)
                stored.append(key)
                self.session.add(
                    SupportTicketAttachment(
                        ticket_id=ticket_uuid,
                        object_key=key,
                        file_name=upload.file_name,
                        content_type=upload.content_type,
                        size_bytes=len(upload.content),
                        created_by=actor.id,
                        updated_by=actor.id,
                    )
                )
            await self.session.commit()
        except StorageError as exc:
            await self.session.rollback()
            await self._discard(storage, stored)
            logger.error("support_attachment_upload_failed", ticket_id=public_id, error=str(exc))
            raise AppError(
                error_codes.STORAGE_UNAVAILABLE, "We could not store your attachment right now. Please try again.", 503
            ) from exc
        except Exception:
            await self.session.rollback()
            await self._discard(storage, stored)
            raise
        logger.info("support_attachments_added", ticket_id=public_id, count=len(uploads))
        await self.session.refresh(ticket)
        return await self._ticket_dict(ticket)

    @staticmethod
    async def _discard(storage: Storage, keys: list[str]) -> None:
        for key in keys:
            try:
                await asyncio.to_thread(storage.delete_object, key)
            except StorageError as exc:
                logger.warning("support_attachment_cleanup_failed", object_key=key, error=str(exc))

    @log_flow(layer="service")
    async def attachment_download(self, ticket_id: str, attachment_id: str, actor: Profile) -> dict:
        """A short-lived link that saves the file, for support staff or the person who raised the ticket."""
        ticket = await self.session.get(SupportTicket, ticket_id)
        if ticket is None or (actor.role not in {"support", "support-admin", "admin"} and ticket.caller_id != actor.id):
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Attachment not found.", 404)
        attachment = await self.session.get(SupportTicketAttachment, attachment_id)
        if attachment is None or attachment.ticket_id != ticket.id:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Attachment not found.", 404)
        url = get_storage().create_download(attachment.object_key, as_attachment=True, filename=attachment.file_name)
        return {"url": url, "file_name": attachment.file_name, "content_type": attachment.content_type}

    @log_flow(layer="service")
    async def update_ticket(self, ticket_id: str, payload: TicketUpdate, actor: Profile) -> dict:
        ticket = await self.session.get(SupportTicket, ticket_id)
        if ticket is None:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Ticket not found.", 404)
        if actor.role not in {"support", "support-admin", "admin"} and ticket.caller_id != actor.id:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Ticket not found.", 404)
        if payload.status:
            ticket.status = payload.status
        if payload.note:
            ticket.notes = [
                *ticket.notes,
                {"at": datetime.now(UTC).isoformat(), "actor_id": actor.id, "note": payload.note},
            ]
        if payload.rca:
            ticket.rca = payload.rca
        await self.session.commit()
        logger.info("ticket_updated", ticket_id=ticket.ticket_id, actor_id=actor.id, status=ticket.status)
        return await self._ticket_dict(ticket)

    @log_flow(layer="service")
    async def list_verifications(self) -> list[dict]:
        rows = list(
            (
                await self.session.execute(select(SupportVerification).order_by(SupportVerification.created_at.desc()))
            ).scalars()
        )
        profiles = await self._profile_map({row.profile_id for row in rows})
        state_ids = {profile.state_id for profile in profiles.values() if profile.state_id}
        states = {}
        if state_ids:
            state_rows = (await self.session.execute(select(State).where(State.id.in_(state_ids)))).scalars()
            states = {row.id: row for row in state_rows}
        deciders = await self._profile_map({row.decided_by for row in rows if row.decided_by})
        documents = await self._dealer_document_map({row.profile_id for row in rows})
        return [
            self._verification_payload(
                row,
                profiles.get(row.profile_id),
                states.get(profiles[row.profile_id].state_id) if row.profile_id in profiles else None,
                deciders.get(row.decided_by) if row.decided_by else None,
                documents.get(row.profile_id, []),
            )
            for row in rows
        ]

    @log_flow(layer="service")
    async def verification_document_download(self, verification_id: str, document_id: str) -> dict:
        """A short-lived link that opens an applicant's signup document in the browser, for support review."""
        verification = await self.session.get(SupportVerification, verification_id)
        document = await self.session.get(DealerDocument, document_id)
        if verification is None or document is None or document.profile_id != verification.profile_id:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Document not found.", 404)
        url = get_storage().create_download(document.object_key)
        logger.info("verification_document_opened", verification_id=verification.id, document_id=document.id)
        return {"url": url, "file_name": document.file_name, "content_type": document.content_type}

    @log_flow(layer="service")
    async def decide_verification(self, verification_id: str, payload: VerificationDecision, actor: Profile) -> dict:
        verification = await self.session.get(SupportVerification, verification_id)
        if verification is None:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Verification not found.", 404)
        if verification.status != "pending":
            raise AppError(error_codes.ILLEGAL_TRANSITION, "This verification has already been decided.", 422)
        if verification.category == "agent" and actor.role not in {"support-admin", "admin"}:
            raise AppError(
                error_codes.FORBIDDEN_ROLE, "Only a support administrator can approve support accounts.", 403
            )
        verification.status = payload.decision
        verification.decided_by = actor.id
        verification.decided_at = datetime.now(UTC)
        verification.notes = [
            *verification.notes,
            {
                "at": datetime.now(UTC).isoformat(),
                "actor_id": actor.id,
                "decision": payload.decision,
                "reason": payload.reason,
            },
        ]
        if payload.decision == "approved":
            user = (
                await self.session.execute(select(User).where(User.profile_id == verification.profile_id))
            ).scalar_one()
            user.is_active = True
            verification.email_sent = True
        await self.session.commit()
        logger.info(
            "verification_decided", verification_id=verification.ticket_id, actor_id=actor.id, decision=payload.decision
        )
        return await self._verification_dict(verification)

    @log_flow(layer="service")
    async def members(self) -> list[dict]:
        rows = (
            await self.session.execute(
                select(Profile, User)
                .join(User, User.profile_id == Profile.id)
                .where(Profile.role.in_(["support", "support-admin"]))
                .order_by(Profile.full_name)
            )
        ).all()
        return [self._member_detail(profile, user) for profile, user in rows]

    @log_flow(layer="service")
    async def member(self, profile_id: str) -> dict:
        row = (
            await self.session.execute(
                select(Profile, User)
                .join(User, User.profile_id == Profile.id)
                .where(Profile.id == profile_id, Profile.role.in_(["support", "support-admin"]))
            )
        ).one_or_none()
        if row is None:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Support member not found.", 404)
        return self._member_detail(*row)

    @staticmethod
    @log_flow(layer="service")
    def _member_detail(profile: Profile, user: User) -> dict:
        return {
            **model_dict(profile),
            "is_active": user.is_active,
            "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        }
