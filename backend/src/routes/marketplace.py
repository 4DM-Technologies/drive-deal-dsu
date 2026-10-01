from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.middleware.auth import get_current_profile, require_roles
from src.models.marketplace import (
    ChatDeclineRequest,
    ChatRequestCreate,
    ChatSend,
    DealStatusUpdate,
    QuoteCreate,
    QuoteRevision,
    RequestCreate,
)
from src.repositories.schema import DealChat, DealQuote, Profile
from src.services.marketplace_service import MarketplaceService

router = APIRouter(tags=["Marketplace"])


@router.get("/requests")
async def requests(profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).list_requests(profile)


@router.post("/requests", status_code=status.HTTP_201_CREATED)
async def create_request(payload: RequestCreate, profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).create_request(payload, profile)


@router.get("/requests/{request_id}")
async def get_request(request_id: str, profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).get_request(request_id, profile)


@router.post("/requests/{request_id}/publish")
async def publish_request(request_id: str, profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)):
    service = MarketplaceService(session)
    row = await service._request(request_id)
    service._require_owner(row.buyer_id, profile.id)
    row.status = "open"
    await session.commit()
    await session.refresh(row)
    return await service.request_dict(row)


@router.post("/requests/{request_id}/close")
async def close_request(request_id: str, profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)):
    service = MarketplaceService(session)
    row = await service._request(request_id)
    service._require_owner(row.buyer_id, profile.id)
    row.status = "closed"
    await session.commit()
    await session.refresh(row)
    return await service.request_dict(row)


@router.get("/requests/{request_id}/quotes")
async def request_quotes(request_id: str, profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).list_quotes(profile, request_id)


@router.get("/feed/requests")
async def feed(profile: Profile = Depends(require_roles("dealer")), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).list_requests(profile)


@router.get("/feed/requests/{request_id}")
async def feed_detail(request_id: str, profile: Profile = Depends(require_roles("dealer")), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).get_request(request_id, profile)


@router.get("/quotes")
async def quotes(request_id: str | None = Query(default=None), profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).list_quotes(profile, request_id)


@router.post("/quotes", status_code=status.HTTP_201_CREATED)
async def create_quote(payload: QuoteCreate, profile: Profile = Depends(require_roles("dealer")), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).create_quote(payload, profile)


@router.get("/quotes/{quote_id}")
async def quote_detail(quote_id: str, profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    service = MarketplaceService(session)
    row = await service._quote(quote_id)
    service._require_party(row, profile)
    return await service.quote_dict(row)


@router.patch("/quotes/{quote_id}/revise")
async def revise_quote(quote_id: str, payload: QuoteRevision, profile: Profile = Depends(require_roles("dealer")), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).revise_quote(quote_id, payload, profile)


@router.post("/quotes/{quote_id}/accept")
async def accept_quote(quote_id: str, profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).accept_quote(quote_id, profile)


@router.post("/quotes/{quote_id}/decline")
async def decline_quote(quote_id: str, profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)):
    service = MarketplaceService(session)
    row = await service._quote(quote_id)
    service._require_owner(row.buyer_id, profile.id)
    row.status = "declined"
    await session.commit()
    await session.refresh(row)
    return await service.quote_dict(row)


@router.post("/quotes/{quote_id}/withdraw")
async def withdraw_quote(quote_id: str, profile: Profile = Depends(require_roles("dealer")), session: AsyncSession = Depends(get_session)):
    service = MarketplaceService(session)
    row = await service._quote(quote_id)
    service._require_owner(row.dealer_id, profile.id)
    row.status = "withdrawn"
    await session.commit()
    await session.refresh(row)
    return await service.quote_dict(row)


@router.post("/requests/{request_id}/compare-ids")
async def compare_ids(request_id: str, profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)):
    service = MarketplaceService(session)
    request = await service._request(request_id)
    service._require_owner(request.buyer_id, profile.id)
    rows = (await session.execute(select(DealQuote.id).where(DealQuote.buyer_request_id == request_id, DealQuote.status.in_(["pending", "negotiating"])))).scalars()
    return {"request_id": request_id, "quote_ids": list(rows)}


@router.get("/quotes/{quote_id}/dealer-contact")
async def dealer_contact(quote_id: str, profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).dealer_contact(quote_id, profile)


@router.post("/chats/{quote_id}/request-access")
async def request_chat(quote_id: str, payload: ChatRequestCreate, profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).request_chat(quote_id, payload, profile)


@router.get("/chats/requests")
async def chat_requests(profile: Profile = Depends(require_roles("dealer")), session: AsyncSession = Depends(get_session)):
    rows = await MarketplaceService(session).list_quotes(profile)
    return [row for row in rows if row["chat_request_status"] == "pending"]


@router.post("/chats/requests/{quote_id}/accept")
async def accept_chat(quote_id: str, profile: Profile = Depends(require_roles("dealer")), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).accept_chat(quote_id, profile)


@router.post("/chats/requests/{quote_id}/decline")
async def decline_chat(quote_id: str, payload: ChatDeclineRequest | None = Body(default=None), profile: Profile = Depends(require_roles("dealer")), session: AsyncSession = Depends(get_session)):
    service = MarketplaceService(session)
    row = await service._quote(quote_id)
    service._require_owner(row.dealer_id, profile.id)
    row.chat_request_status = "declined"
    row.chat_decided_at = datetime.now(UTC)
    row.deal_history = [*row.deal_history, {"event": "chat_request_declined", "reason": payload.reason if payload else None, "actor_id": profile.id, "at": row.chat_decided_at.isoformat()}]
    await session.commit()
    await session.refresh(row)
    return await service.quote_dict(row)


@router.get("/chats/{quote_id}")
async def chat_messages(quote_id: str, profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).chat_messages(quote_id, profile)


@router.post("/chats/{quote_id}", status_code=status.HTTP_201_CREATED)
async def send_chat(quote_id: str, payload: ChatSend, profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).send_chat(quote_id, payload, profile)


@router.post("/chats/{quote_id}/request-negotiation")
async def request_negotiation(quote_id: str, payload: ChatRequestCreate, profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).request_chat(quote_id, payload, profile)


@router.post("/chats/{quote_id}/read")
async def mark_chat_read(quote_id: str, profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    service = MarketplaceService(session)
    quote = await service._quote(quote_id)
    service._require_party(quote, profile)
    rows = (await session.execute(select(DealChat).where(DealChat.quote_id == quote_id, DealChat.sender_id != profile.id))).scalars()
    read_at = datetime.now(UTC)
    for row in rows:
        row.read_at = read_at
    await session.commit()
    return {"quote_id": quote_id, "read_at": read_at.isoformat()}


@router.delete("/chats/{quote_id}/clear", status_code=status.HTTP_204_NO_CONTENT)
async def clear_chat(quote_id: str, profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    service = MarketplaceService(session)
    quote = await service._quote(quote_id)
    service._require_party(quote, profile)
    rows = (await session.execute(select(DealChat).where(DealChat.quote_id == quote_id))).scalars()
    for row in rows:
        row.hidden_for = list({*row.hidden_for, profile.id})
    await session.commit()


@router.post("/chats/ws-ticket")
async def ws_ticket(profile: Profile = Depends(get_current_profile)):
    return {"ticket": str(uuid4()), "profile_id": profile.id, "expires_in": 60}


@router.get("/deals")
async def deals(profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    rows = await MarketplaceService(session).list_quotes(profile)
    return [row for row in rows if row["status"] == "accepted"]


@router.get("/deals/{quote_id}")
async def deal_detail(quote_id: str, profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    return await quote_detail(quote_id, profile, session)


@router.patch("/deals/{quote_id}/status")
async def deal_status(quote_id: str, payload: DealStatusUpdate, profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    return await MarketplaceService(session).update_deal_status(quote_id, payload, profile)
