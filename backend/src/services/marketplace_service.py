from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from src.models.marketplace import (
    ChatRequestCreate,
    ChatSend,
    DealStatusUpdate,
    QuoteCreate,
    QuoteRevision,
    RequestCreate,
)
from src.repositories.marketplace_repository import MarketplaceRepository
from src.repositories.schema import Brand, BuyerRequest, DealChat, DealQuote, Profile
from src.utils.exceptions import AppError, error_codes
from src.utils.serialization import model_dict

DEAL_FLOW = ["paperwork_going_on", "funds_arrived", "dispatch", "delivery", "completed"]


class MarketplaceService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repository = MarketplaceRepository(session)

    async def request_dict(self, row: BuyerRequest, *, already_quoted: bool | None = None) -> dict:
        brand = await self.session.get(Brand, row.brand_id)
        extra = {} if already_quoted is None else {"already_quoted": already_quoted}
        return {**model_dict(row), "brand_name": brand.name if brand else None, **extra}

    async def quote_dict(self, row: DealQuote) -> dict:
        dealer = await self.session.get(Profile, row.dealer_id)
        request = await self.session.get(BuyerRequest, row.buyer_request_id)
        brand = await self.session.get(Brand, request.brand_id) if request else None
        return {
            **model_dict(row),
            "dealer_name": (dealer.dealership_name or dealer.full_name) if dealer else None,
            "brand_name": brand.name if brand else None,
            "model": request.model if request else None,
            "year_min": request.year_min if request else None,
            "year_max": request.year_max if request else None,
            "body_type": request.body_type if request else None,
            "buyer_area": request.buyer_area if request else None,
        }

    async def list_requests(self, actor: Profile) -> list[dict]:
        if actor.role == "buyer":
            rows = await self.repository.buyer_requests(actor.id)
            return [await self.request_dict(row) for row in rows]
        rows = await self.repository.request_feed()
        quoted_ids = {quote.buyer_request_id for quote in await self.repository.quotes_for_dealer(actor.id)}
        return [await self.request_dict(row, already_quoted=row.id in quoted_ids) for row in rows]

    async def get_request(self, request_id: str, actor: Profile) -> dict:
        row = await self._request(request_id)
        if actor.role == "buyer" and row.buyer_id != actor.id:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Request not found.", 404)
        if actor.role == "dealer" and row.status != "open":
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Request not found.", 404)
        return await self.request_dict(row)

    async def create_request(self, payload: RequestCreate, buyer: Profile) -> dict:
        row = BuyerRequest(buyer_id=buyer.id, **payload.model_dump())
        self.repository.add(row)
        await self.repository.commit()
        await self.session.refresh(row)
        return await self.request_dict(row)

    async def list_quotes(self, actor: Profile, request_id: str | None = None) -> list[dict]:
        if actor.role == "dealer":
            rows = await self.repository.quotes_for_dealer(actor.id)
        elif request_id:
            request = await self._request(request_id)
            self._require_owner(request.buyer_id, actor.id)
            rows = await self.repository.quotes_for_request(request_id)
        else:
            requests = await self.repository.buyer_requests(actor.id)
            rows = []
            for request in requests:
                rows.extend(await self.repository.quotes_for_request(request.id))
        return [await self.quote_dict(row) for row in rows]

    async def create_quote(self, payload: QuoteCreate, dealer: Profile) -> dict:
        request = await self._request(payload.buyer_request_id)
        if request.status != "open":
            raise AppError(error_codes.CONFLICT, "Only open requests can receive quotes.", 409)
        row = DealQuote(buyer_id=request.buyer_id, dealer_id=dealer.id, **payload.model_dump())
        self.repository.add(row)
        await self.repository.commit()
        await self.session.refresh(row)
        return await self.quote_dict(row)

    async def revise_quote(self, quote_id: str, payload: QuoteRevision, dealer: Profile) -> dict:
        quote = await self._quote(quote_id)
        self._require_owner(quote.dealer_id, dealer.id)
        if quote.status not in {"pending", "negotiating"}:
            raise AppError(error_codes.ILLEGAL_TRANSITION, "This quote can no longer be revised.", 422)
        previous = f"{quote.final_price:.2f}"
        for key, value in payload.model_dump(exclude_none=True).items():
            setattr(quote, key, value)
        await self.session.flush()
        quote.deal_history = [*quote.deal_history, {"ts": datetime.now(UTC).isoformat(), "actor_id": dealer.id, "actor_role": dealer.role, "event": "quote_revised", "previous_final_price": previous}]
        await self.repository.commit()
        await self.session.refresh(quote)
        return await self.quote_dict(quote)

    async def accept_quote(self, quote_id: str, buyer: Profile) -> dict:
        quote = await self._quote(quote_id)
        self._require_owner(quote.buyer_id, buyer.id)
        if quote.status not in {"pending", "negotiating"}:
            raise AppError(error_codes.ILLEGAL_TRANSITION, "Only a live quote can be accepted.", 422)
        quote.status = "accepted"
        quote.deal_status = "paperwork_going_on"
        quote.chat_request_status = "accepted"
        quote.deal_history = [*quote.deal_history, {"ts": datetime.now(UTC).isoformat(), "actor_id": buyer.id, "actor_role": buyer.role, "event": "quote_accepted"}]
        request = await self._request(quote.buyer_request_id)
        request.status = "fulfilled"
        for sibling in await self.repository.quotes_for_request(request.id):
            if sibling.id != quote.id and sibling.status in {"pending", "negotiating"}:
                sibling.status = "declined"
        await self.repository.commit()
        await self.session.refresh(quote)
        return await self.quote_dict(quote)

    async def dealer_contact(self, quote_id: str, actor: Profile) -> dict:
        quote = await self._quote(quote_id)
        self._require_party(quote, actor)
        if quote.status != "accepted" and quote.chat_request_status != "accepted":
            raise AppError(error_codes.DEALER_CONTACT_WITHHELD, "Dealer contact remains private until the contact gate opens.", 403)
        dealer = await self.session.get(Profile, quote.dealer_id)
        return {"contact_available": True, "dealer": {"id": dealer.id, "name": dealer.full_name, "dealership_name": dealer.dealership_name, "phone": dealer.phone, "email": dealer.email}}

    async def request_chat(self, quote_id: str, payload: ChatRequestCreate, buyer: Profile) -> dict:
        quote = await self._quote(quote_id)
        self._require_owner(quote.buyer_id, buyer.id)
        quote.chat_request_status = "pending"
        quote.chat_request_message = payload.message
        quote.chat_requested_at = datetime.now(UTC)
        await self.repository.commit()
        await self.session.refresh(quote)
        return await self.quote_dict(quote)

    async def accept_chat(self, quote_id: str, dealer: Profile) -> dict:
        quote = await self._quote(quote_id)
        self._require_owner(quote.dealer_id, dealer.id)
        if quote.chat_request_status != "pending":
            raise AppError(error_codes.ILLEGAL_TRANSITION, "This chat request is not pending.", 422)
        quote.chat_request_status = "accepted"
        quote.chat_decided_at = datetime.now(UTC)
        if quote.status == "pending":
            quote.status = "negotiating"
        self.repository.add(DealChat(quote_id=quote.id, sender_id=quote.buyer_id, message=quote.chat_request_message or "I would like to discuss this offer."))
        await self.repository.commit()
        await self.session.refresh(quote)
        return await self.quote_dict(quote)

    async def chat_messages(self, quote_id: str, actor: Profile) -> list[dict]:
        quote = await self._quote(quote_id)
        self._require_party(quote, actor)
        if quote.status != "accepted" and quote.chat_request_status != "accepted":
            raise AppError(error_codes.CHAT_NOT_OPEN, "This conversation is not open.", 403)
        return [model_dict(row) for row in await self.repository.chat_messages(quote_id) if actor.id not in row.hidden_for]

    async def send_chat(self, quote_id: str, payload: ChatSend, actor: Profile) -> dict:
        quote = await self._quote(quote_id)
        self._require_party(quote, actor)
        if quote.status != "accepted" and quote.chat_request_status != "accepted":
            raise AppError(error_codes.CHAT_NOT_OPEN, "This conversation is not open.", 403)
        existing = next((row for row in await self.repository.chat_messages(quote_id) if row.client_message_id == payload.id), None)
        if existing:
            return model_dict(existing)
        row = DealChat(quote_id=quote_id, sender_id=actor.id, message=payload.message, client_message_id=payload.id)
        self.repository.add(row)
        await self.repository.commit()
        await self.session.refresh(row)
        return model_dict(row)

    async def update_deal_status(self, quote_id: str, payload: DealStatusUpdate, actor: Profile) -> dict:
        quote = await self._quote(quote_id)
        self._require_party(quote, actor)
        if quote.status != "accepted":
            raise AppError(error_codes.ILLEGAL_TRANSITION, "Only accepted quotes have a deal status.", 422)
        current = quote.deal_status
        allowed = payload.status == "cancelled" or (current in DEAL_FLOW and DEAL_FLOW.index(payload.status) == DEAL_FLOW.index(current) + 1)
        if current is None:
            allowed = payload.status == "paperwork_going_on"
        if not allowed or current in {"completed", "cancelled"}:
            raise AppError(error_codes.ILLEGAL_TRANSITION, "That deal status transition is not allowed.", 422)
        quote.deal_status = payload.status
        quote.deal_history = [*quote.deal_history, {"ts": datetime.now(UTC).isoformat(), "actor_id": actor.id, "actor_role": actor.role, "event": "deal_status_changed", "from": current, "to": payload.status}]
        await self.repository.commit()
        await self.session.refresh(quote)
        return await self.quote_dict(quote)

    async def _request(self, request_id: str) -> BuyerRequest:
        row = await self.repository.request_by_id(request_id)
        if row is None:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Request not found.", 404)
        return row

    async def _quote(self, quote_id: str) -> DealQuote:
        row = await self.repository.quote_by_id(quote_id)
        if row is None:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Quote not found.", 404)
        return row

    @staticmethod
    def _require_owner(owner_id: str, actor_id: str) -> None:
        if owner_id != actor_id:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Resource not found.", 404)

    @staticmethod
    def _require_party(quote: DealQuote, actor: Profile) -> None:
        if actor.role not in {"support", "admin"} and actor.id not in {quote.buyer_id, quote.dealer_id}:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Resource not found.", 404)
