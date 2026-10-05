from datetime import UTC, datetime
from time import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.marketplace import TicketCreate, TicketUpdate, VerificationDecision
from src.repositories.schema import Profile, State, SupportTicket, SupportVerification, User
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow
from src.utils.logger import logger
from src.utils.serialization import model_dict


class SupportService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @log_flow(layer="service")
    async def _ticket_dict(self, row: SupportTicket) -> dict:
        caller = await self.session.get(Profile, row.caller_id)
        return {
            **model_dict(row),
            "caller_name": caller.full_name if caller else None,
            "caller_email": caller.email if caller else None,
            "caller_role": caller.role if caller else None,
        }

    @log_flow(layer="service")
    async def _verification_dict(self, row: SupportVerification) -> dict:
        profile = await self.session.get(Profile, row.profile_id)
        state = await self.session.get(State, profile.state_id) if profile and profile.state_id else None
        decider = await self.session.get(Profile, row.decided_by) if row.decided_by else None
        return self._verification_payload(row, profile, state, decider)

    @staticmethod
    def _verification_payload(
        row: SupportVerification,
        profile: Profile | None,
        state: State | None,
        decider: Profile | None,
    ) -> dict:
        return {
            **model_dict(row),
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
        return [
            {
                **model_dict(row),
                "caller_name": callers[row.caller_id].full_name if row.caller_id in callers else None,
                "caller_email": callers[row.caller_id].email if row.caller_id in callers else None,
                "caller_role": callers[row.caller_id].role if row.caller_id in callers else None,
            }
            for row in rows
        ]

    @log_flow(layer="service")
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
        return [
            self._verification_payload(
                row,
                profiles.get(row.profile_id),
                states.get(profiles[row.profile_id].state_id) if row.profile_id in profiles else None,
                deciders.get(row.decided_by) if row.decided_by else None,
            )
            for row in rows
        ]

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
