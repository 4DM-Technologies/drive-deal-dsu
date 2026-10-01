from datetime import UTC, datetime
from time import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.marketplace import TicketCreate, TicketUpdate, VerificationDecision
from src.repositories.schema import Profile, State, SupportTicket, SupportVerification, User
from src.utils.exceptions import AppError, error_codes
from src.utils.logger import logger
from src.utils.serialization import model_dict


class SupportService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _ticket_dict(self, row: SupportTicket) -> dict:
        caller = await self.session.get(Profile, row.caller_id)
        return {**model_dict(row), "caller_name": caller.full_name if caller else None}

    async def _verification_dict(self, row: SupportVerification) -> dict:
        profile = await self.session.get(Profile, row.profile_id)
        state = await self.session.get(State, profile.state_id) if profile and profile.state_id else None
        return {**model_dict(row), "profile_name": profile.full_name if profile else None, "business_name": profile.dealership_name if profile else None, "state": state.name if state else None}

    async def _profile_map(self, profile_ids: set[str]) -> dict[str, Profile]:
        if not profile_ids:
            return {}
        rows = (await self.session.execute(select(Profile).where(Profile.id.in_(profile_ids)))).scalars()
        return {row.id: row for row in rows}

    async def list_tickets(self, actor: Profile, queue: bool = False) -> list[dict]:
        statement = select(SupportTicket).order_by(SupportTicket.created_at.desc())
        if not queue or actor.role not in {"support", "support-admin", "admin"}:
            statement = statement.where(SupportTicket.caller_id == actor.id)
        rows = list((await self.session.execute(statement)).scalars())
        callers = await self._profile_map({row.caller_id for row in rows})
        return [{**model_dict(row), "caller_name": callers[row.caller_id].full_name if row.caller_id in callers else None} for row in rows]

    async def create_ticket(self, payload: TicketCreate, actor: Profile) -> dict:
        category = "dealer" if actor.role == "dealer" else "customer"
        prefix = "DS" if category == "dealer" else "TIC-"
        ticket = SupportTicket(
            ticket_id=f"{prefix}{str(int(time()))[-6:]}",
            category=category,
            caller_id=actor.id,
            **payload.model_dump(),
        )
        self.session.add(ticket)
        await self.session.commit()
        await self.session.refresh(ticket)
        logger.info("ticket_created", ticket_id=ticket.ticket_id, caller_id=actor.id, category=category)
        return await self._ticket_dict(ticket)

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
        logger.info("ticket_updated", ticket_id=ticket.ticket_id, actor_id=actor.id, status=ticket.status)
        return await self._ticket_dict(ticket)

    async def list_verifications(self) -> list[dict]:
        rows = list((await self.session.execute(select(SupportVerification).order_by(SupportVerification.created_at.desc()))).scalars())
        profiles = await self._profile_map({row.profile_id for row in rows})
        state_ids = {profile.state_id for profile in profiles.values() if profile.state_id}
        states = {}
        if state_ids:
            state_rows = (await self.session.execute(select(State).where(State.id.in_(state_ids)))).scalars()
            states = {row.id: row for row in state_rows}
        return [
            {
                **model_dict(row),
                "profile_name": profiles[row.profile_id].full_name if row.profile_id in profiles else None,
                "business_name": profiles[row.profile_id].dealership_name if row.profile_id in profiles else None,
                "state": states[profiles[row.profile_id].state_id].name if row.profile_id in profiles and profiles[row.profile_id].state_id in states else None,
            }
            for row in rows
        ]

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
        logger.info("verification_decided", verification_id=verification.ticket_id, actor_id=actor.id, decision=payload.decision)
        return await self._verification_dict(verification)

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
    def _member_detail(profile: Profile, user: User) -> dict:
        return {
            **model_dict(profile),
            "is_active": user.is_active,
            "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        }
