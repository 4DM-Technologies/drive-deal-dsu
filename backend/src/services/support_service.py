from datetime import UTC, datetime
from time import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.marketplace import TicketCreate, TicketUpdate, VerificationDecision
from src.repositories.schema import Profile, SupportTicket, SupportVerification, User
from src.utils.exceptions import AppError, error_codes
from src.utils.serialization import model_dict


class SupportService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_tickets(self, actor: Profile, queue: bool = False) -> list[dict]:
        statement = select(SupportTicket).order_by(SupportTicket.created_at.desc())
        if not queue or actor.role not in {"support", "support-admin", "admin"}:
            statement = statement.where(SupportTicket.caller_id == actor.id)
        rows = (await self.session.execute(statement)).scalars()
        return [model_dict(row) for row in rows]

    async def create_ticket(self, payload: TicketCreate, actor: Profile) -> dict:
        prefix = "TIC" if payload.category == "customer" else "DS"
        ticket = SupportTicket(ticket_id=f"{prefix}-{str(int(time()))[-6:]}", caller_id=actor.id, **payload.model_dump())
        self.session.add(ticket)
        await self.session.commit()
        await self.session.refresh(ticket)
        return model_dict(ticket)

    async def update_ticket(self, ticket_id: str, payload: TicketUpdate, actor: Profile) -> dict:
        ticket = await self.session.get(SupportTicket, ticket_id)
        if ticket is None:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Ticket not found.", 404)
        if actor.role not in {"support", "support-admin", "admin"} and ticket.caller_id != actor.id:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Ticket not found.", 404)
        if payload.status:
            ticket.status = payload.status
        if payload.note:
            ticket.notes = [*ticket.notes, {"at": datetime.now(UTC).isoformat(), "actor_id": actor.id, "note": payload.note}]
        if payload.rca:
            ticket.rca = payload.rca
        await self.session.commit()
        return model_dict(ticket)

    async def list_verifications(self) -> list[dict]:
        rows = (await self.session.execute(select(SupportVerification).order_by(SupportVerification.created_at.desc()))).scalars()
        return [model_dict(row) for row in rows]

    async def decide_verification(self, verification_id: str, payload: VerificationDecision, actor: Profile) -> dict:
        verification = await self.session.get(SupportVerification, verification_id)
        if verification is None:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Verification not found.", 404)
        if verification.status != "pending":
            raise AppError(error_codes.ILLEGAL_TRANSITION, "This verification has already been decided.", 422)
        if verification.category == "agent" and actor.role not in {"support-admin", "admin"}:
            raise AppError(error_codes.FORBIDDEN_ROLE, "Only a support administrator can approve support accounts.", 403)
        verification.status = payload.decision
        verification.decided_by = actor.id
        verification.decided_at = datetime.now(UTC)
        verification.notes = [*verification.notes, {"at": datetime.now(UTC).isoformat(), "actor_id": actor.id, "decision": payload.decision, "reason": payload.reason}]
        if payload.decision == "approved":
            user = (await self.session.execute(select(User).where(User.profile_id == verification.profile_id))).scalar_one()
            user.is_active = True
            verification.email_sent = True
        await self.session.commit()
        return model_dict(verification)

    async def members(self) -> list[dict]:
        rows = (await self.session.execute(select(Profile).where(Profile.role.in_(["support", "support-admin", "admin"])).order_by(Profile.full_name))).scalars()
        return [model_dict(row) for row in rows]
