from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.middleware.auth import get_current_profile, require_roles
from src.models.marketplace import (
    SupportRoleUpdate,
    TicketCreate,
    TicketUpdate,
    VerificationDecision,
    VerificationReasonRequest,
)
from src.repositories.schema import Profile, User
from src.services.support_service import SupportService
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow
from src.utils.logger import logger

router = APIRouter(tags=["Support"])


@router.get("/support/tickets")
@log_flow(layer="route")
async def own_tickets(profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    return await SupportService(session).list_tickets(profile)


@router.get("/support/tickets/{ticket_id}")
@log_flow(layer="route")
async def own_ticket(ticket_id: str, profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    rows = await SupportService(session).list_tickets(profile)
    row = next((item for item in rows if item["id"] == ticket_id), None)
    if row is None:
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "Ticket not found.", 404)
    return row


@router.post("/support/tickets", status_code=status.HTTP_201_CREATED)
@log_flow(layer="route")
async def create_ticket(payload: TicketCreate, profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    return await SupportService(session).create_ticket(payload, profile)


@router.patch("/support/tickets/{ticket_id}")
@log_flow(layer="route")
async def update_own_ticket(ticket_id: str, payload: TicketUpdate, profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    return await SupportService(session).update_ticket(ticket_id, payload, profile)


@router.get("/support/queue/tickets")
@log_flow(layer="route")
async def ticket_queue(profile: Profile = Depends(require_roles("support", "support-admin", "admin")), session: AsyncSession = Depends(get_session)):
    return await SupportService(session).list_tickets(profile, queue=True)


@router.patch("/support/queue/tickets/{ticket_id}")
@log_flow(layer="route")
async def update_queue_ticket(ticket_id: str, payload: TicketUpdate, profile: Profile = Depends(require_roles("support", "support-admin", "admin")), session: AsyncSession = Depends(get_session)):
    return await SupportService(session).update_ticket(ticket_id, payload, profile)


@router.get("/verifications")
@log_flow(layer="route")
async def verifications(profile: Profile = Depends(require_roles("support", "support-admin", "admin")), session: AsyncSession = Depends(get_session)):
    return await SupportService(session).list_verifications()


@router.post("/verifications/{verification_id}/approve")
@log_flow(layer="route")
async def approve(verification_id: str, payload: VerificationReasonRequest, profile: Profile = Depends(require_roles("support", "support-admin", "admin")), session: AsyncSession = Depends(get_session)):
    decision = VerificationDecision(decision="approved", reason=payload.reason)
    return await SupportService(session).decide_verification(verification_id, decision, profile)


@router.post("/verifications/{verification_id}/deny")
@log_flow(layer="route")
async def deny(verification_id: str, payload: VerificationReasonRequest, profile: Profile = Depends(require_roles("support", "support-admin", "admin")), session: AsyncSession = Depends(get_session)):
    decision = VerificationDecision(decision="denied", reason=payload.reason)
    return await SupportService(session).decide_verification(verification_id, decision, profile)


@router.post("/verifications/{verification_id}/reject")
@log_flow(layer="route")
async def reject(verification_id: str, payload: VerificationReasonRequest, profile: Profile = Depends(require_roles("support", "support-admin", "admin")), session: AsyncSession = Depends(get_session)):
    decision = VerificationDecision(decision="rejected", reason=payload.reason)
    return await SupportService(session).decide_verification(verification_id, decision, profile)


@router.get("/members")
@log_flow(layer="route")
async def members(profile: Profile = Depends(require_roles("support", "support-admin", "admin")), session: AsyncSession = Depends(get_session)):
    return await SupportService(session).members()


@router.get("/members/{profile_id}")
@log_flow(layer="route")
async def member_detail(profile_id: str, profile: Profile = Depends(require_roles("support", "support-admin", "admin")), session: AsyncSession = Depends(get_session)):
    return await SupportService(session).member(profile_id)


@router.patch("/members/{profile_id}/support-role")
@log_flow(layer="route")
async def update_support_role(profile_id: str, payload: SupportRoleUpdate, actor: Profile = Depends(require_roles("support-admin", "admin")), session: AsyncSession = Depends(get_session)):
    if profile_id == actor.id:
        raise AppError(error_codes.CONFLICT, "You cannot change your own support role.", 409)
    profile = await session.get(Profile, profile_id)
    if profile is None or profile.role not in {"support", "support-admin"}:
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "Support member not found.", 404)
    profile.role = payload.role
    profile.updated_by = actor.id
    user = (await session.execute(select(User).where(User.profile_id == profile_id))).scalar_one()
    user.refresh_token_hash = None
    user.updated_by = actor.id
    await session.commit()
    logger.info("support_role_changed", profile_id=profile.id, role=profile.role, actor_id=actor.id)
    return {"profile_id": profile.id, "role": profile.role, "requires_sign_in": True}


@router.post("/members/{profile_id}/suspend")
@log_flow(layer="route")
async def suspend_member(profile_id: str, actor: Profile = Depends(require_roles("admin")), session: AsyncSession = Depends(get_session)):
    if profile_id == actor.id:
        raise AppError(error_codes.CONFLICT, "You cannot suspend your own account.", 409)
    user = (await session.execute(select(User).where(User.profile_id == profile_id))).scalar_one_or_none()
    if user is None:
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "Member not found.", 404)
    user.is_active = False
    user.updated_by = actor.id
    await session.commit()
    logger.info("member_suspended", profile_id=profile_id, actor_id=actor.id)
    return {"profile_id": profile_id, "is_active": False}
