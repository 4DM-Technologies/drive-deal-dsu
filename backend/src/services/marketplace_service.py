from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.marketplace import (
    ChatEdit,
    ChatRequestCreate,
    ChatSend,
    DealStatusUpdate,
    QuoteCreate,
    QuoteRevision,
    RequestCreate,
)
from src.repositories.marketplace_repository import MarketplaceRepository
from src.repositories.schema import Brand, BuyerRequest, DealChat, DealQuote, Profile
from src.services.billing_service import BillingService
from src.services.community_guidelines import violates_chat_guidelines
from src.settings import MARKETPLACE_DEAL_FLOW
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow
from src.utils.logger import logger
from src.utils.serialization import model_dict

CHAT_UNSENT_MARKER = "__dealdrive_message_unsent__"
CHAT_UNSENT_TEXT = "This message was unsent."
CHAT_GUIDELINE_MESSAGE = "Please keep messages respectful. This wording violates our community guidelines."


class MarketplaceService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repository = MarketplaceRepository(session)

    @log_flow(layer="service")
    async def request_dict(self, row: BuyerRequest, *, already_quoted: bool | None = None) -> dict:
        brand = await self.session.get(Brand, row.brand_id)
        extra = {} if already_quoted is None else {"already_quoted": already_quoted}
        counts = (await self.repository.request_activity_counts([row.id]))[row.id]
        return {**model_dict(row), "brand_name": brand.name if brand else None, **counts, **extra}

    @log_flow(layer="service")
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
            "buyer_viewed": self._buyer_viewed(row),
        }

    @staticmethod
    def _buyer_viewed(row: DealQuote) -> bool:
        """Whether the buyer has seen the quote as it stands now.

        ``read_by_buyer`` is set when the buyer opens it and cleared when the dealer revises it. Accepting or
        declining a quote is definitive proof the buyer saw it, which also covers quotes decided before views
        were tracked.
        """
        return row.read_by_buyer or row.status in {"accepted", "declined"}

    @log_flow(layer="service")
    async def get_quote(self, quote_id: str, actor: Profile) -> dict:
        row = await self._quote(quote_id)
        self._require_party(row, actor)
        data = await self.quote_dict(row)
        await self._mark_read_by_buyer([row], actor)
        return data

    @log_flow(layer="service")
    async def _mark_read_by_buyer(self, rows: list[DealQuote], actor: Profile) -> None:
        """A buyer opening their quotes is what "viewed by the buyer" means; nobody else's reads count."""
        if actor.role != "buyer":
            return
        await self.repository.mark_quotes_read_by_buyer(
            [row.id for row in rows if row.buyer_id == actor.id and not row.read_by_buyer]
        )

    @log_flow(layer="service")
    async def _brand_map(self, brand_ids: set[str]) -> dict[str, Brand]:
        if not brand_ids:
            return {}
        rows = (await self.session.execute(select(Brand).where(Brand.id.in_(brand_ids)))).scalars()
        return {row.id: row for row in rows}

    @log_flow(layer="service")
    async def _profile_map(self, profile_ids: set[str]) -> dict[str, Profile]:
        if not profile_ids:
            return {}
        rows = (await self.session.execute(select(Profile).where(Profile.id.in_(profile_ids)))).scalars()
        return {row.id: row for row in rows}

    @staticmethod
    def _chat_sender_name(profile: Profile | None) -> str:
        if profile is None:
            return "Account unavailable"
        if profile.role == "dealer":
            return profile.dealership_name or profile.full_name
        return profile.full_name

    @log_flow(layer="service")
    async def _request_map(self, request_ids: set[str]) -> dict[str, BuyerRequest]:
        if not request_ids:
            return {}
        rows = (await self.session.execute(select(BuyerRequest).where(BuyerRequest.id.in_(request_ids)))).scalars()
        return {row.id: row for row in rows}

    @log_flow(layer="service")
    async def list_requests(self, actor: Profile) -> list[dict]:
        if actor.role == "buyer":
            rows = await self.repository.buyer_requests(actor.id)
            already_quoted = None
        else:
            rows = await self.repository.request_feed()
            quoted_ids = {quote.buyer_request_id for quote in await self.repository.quotes_for_dealer(actor.id)}
            already_quoted = quoted_ids
        brands = await self._brand_map({row.brand_id for row in rows})
        counts = await self.repository.request_activity_counts([row.id for row in rows])
        return [
            {
                **model_dict(row),
                "brand_name": brands[row.brand_id].name if row.brand_id in brands else None,
                **counts[row.id],
                **({} if already_quoted is None else {"already_quoted": row.id in already_quoted}),
            }
            for row in rows
        ]

    @log_flow(layer="service")
    async def get_request(self, request_id: str, actor: Profile) -> dict:
        row = await self._request(request_id)
        if actor.role == "buyer" and row.buyer_id != actor.id:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Request not found.", 404)
        if actor.role == "dealer" and row.status != "open":
            # Once a buyer accepts a quote the request leaves the public feed, but the
            # quoting dealer still needs its details to view the accepted offer/deal.
            if not await self.repository.dealer_has_quote_for_request(actor.id, row.id):
                raise AppError(error_codes.RESOURCE_NOT_FOUND, "Request not found.", 404)
        if actor.role == "dealer" and row.status == "open":
            await self.repository.record_request_view(row.id, actor.id, datetime.now(UTC))
        return await self.request_dict(row)

    @log_flow(layer="service")
    async def create_request(self, payload: RequestCreate, buyer: Profile) -> dict:
        await BillingService(self.session).assert_can_create_request(buyer)
        row = BuyerRequest(buyer_id=buyer.id, **payload.model_dump())
        self.repository.add(row)
        await self.repository.commit()
        await self.session.refresh(row)
        logger.info("request_created", request_id=row.id, buyer_id=buyer.id, status=row.status)
        return await self.request_dict(row)

    @log_flow(layer="service")
    async def publish_request(self, request_id: str, buyer: Profile) -> dict:
        row = await self._request(request_id)
        self._require_owner(row.buyer_id, buyer.id)
        row.status = "open"
        await self.session.commit()
        await self.session.refresh(row)
        logger.info("request_published", request_id=row.id, buyer_id=buyer.id)
        return await self.request_dict(row)

    @log_flow(layer="service")
    async def list_quotes(self, actor: Profile, request_id: str | None = None) -> list[dict]:
        if actor.role == "dealer":
            rows = await self.repository.quotes_for_dealer(actor.id)
        elif request_id:
            request = await self._request(request_id)
            self._require_owner(request.buyer_id, actor.id)
            rows = await self.repository.quotes_for_request(request_id)
        else:
            requests = await self.repository.buyer_requests(actor.id)
            rows = await self.repository.quotes_for_requests([request.id for request in requests])

        dealers = await self._profile_map({row.dealer_id for row in rows})
        requests_by_id = await self._request_map({row.buyer_request_id for row in rows})
        brands = await self._brand_map({request.brand_id for request in requests_by_id.values()})

        def to_dict(row: DealQuote) -> dict:
            dealer = dealers.get(row.dealer_id)
            request = requests_by_id.get(row.buyer_request_id)
            brand = brands.get(request.brand_id) if request else None
            return {
                **model_dict(row),
                "dealer_name": (dealer.dealership_name or dealer.full_name) if dealer else None,
                "brand_name": brand.name if brand else None,
                "model": request.model if request else None,
                "year_min": request.year_min if request else None,
                "year_max": request.year_max if request else None,
                "body_type": request.body_type if request else None,
                "buyer_area": request.buyer_area if request else None,
                "buyer_viewed": self._buyer_viewed(row),
            }

        result = [to_dict(row) for row in rows]
        # Only a buyer opening one request's offers counts as viewing them; the unfiltered list also feeds
        # dashboards and counters. The response shows each quote as it was before this view.
        if request_id:
            await self._mark_read_by_buyer(rows, actor)
        return result

    @log_flow(layer="service")
    async def list_workspace_quotes(self) -> list[dict]:
        """Read-only cross-market quote view for support administrators."""
        rows = list((await self.session.execute(select(DealQuote).order_by(DealQuote.created_at.desc()))).scalars())
        return [await self.quote_dict(row) for row in rows]

    @log_flow(layer="service")
    async def create_quote(self, payload: QuoteCreate, dealer: Profile) -> dict:
        await BillingService(self.session).assert_can_quote(dealer)
        request = await self._request(payload.buyer_request_id)
        if request.status != "open":
            raise AppError(error_codes.CONFLICT, "Only open requests can receive quotes.", 409)
        row = DealQuote(buyer_id=request.buyer_id, dealer_id=dealer.id, **payload.model_dump())
        self.repository.add(row)
        await self.repository.commit()
        await self.session.refresh(row)
        logger.info("quote_created", quote_id=row.id, request_id=request.id, dealer_id=dealer.id)
        return await self.quote_dict(row)

    @log_flow(layer="service")
    async def revise_quote(self, quote_id: str, payload: QuoteRevision, dealer: Profile) -> dict:
        quote = await self._quote(quote_id)
        self._require_owner(quote.dealer_id, dealer.id)
        if quote.status not in {"pending", "negotiating"}:
            raise AppError(error_codes.ILLEGAL_TRANSITION, "This quote can no longer be revised.", 422)
        previous = f"{quote.final_price:.2f}"
        for key, value in payload.model_dump(exclude_none=True).items():
            setattr(quote, key, value)
        # The buyer has not seen the revised offer yet.
        quote.read_by_buyer = False
        await self.session.flush()
        quote.deal_history = [
            *quote.deal_history,
            {
                "ts": datetime.now(UTC).isoformat(),
                "actor_id": dealer.id,
                "actor_role": dealer.role,
                "event": "quote_revised",
                "previous_final_price": previous,
            },
        ]
        await self.repository.commit()
        await self.session.refresh(quote)
        logger.info("quote_revised", quote_id=quote.id, dealer_id=dealer.id, previous_final_price=previous)
        return await self.quote_dict(quote)

    @log_flow(layer="service")
    async def accept_quote(self, quote_id: str, buyer: Profile) -> dict:
        quote = await self._quote(quote_id)
        self._require_owner(quote.buyer_id, buyer.id)
        if quote.status not in {"pending", "negotiating"}:
            raise AppError(error_codes.ILLEGAL_TRANSITION, "Only a live quote can be accepted.", 422)
        quote.status = "accepted"
        quote.deal_status = "paperwork_going_on"
        quote.chat_request_status = "accepted"
        quote.deal_history = [
            *quote.deal_history,
            {
                "ts": datetime.now(UTC).isoformat(),
                "actor_id": buyer.id,
                "actor_role": buyer.role,
                "event": "quote_accepted",
            },
        ]
        request = await self._request(quote.buyer_request_id)
        request.status = "fulfilled"
        for sibling in await self.repository.quotes_for_request(request.id):
            if sibling.id != quote.id and sibling.status in {"pending", "negotiating"}:
                sibling.status = "declined"
        await self.repository.commit()
        await self.session.refresh(quote)
        logger.info("quote_accepted", quote_id=quote.id, buyer_id=buyer.id, request_id=request.id)
        return await self.quote_dict(quote)

    @log_flow(layer="service")
    async def dealer_contact(self, quote_id: str, actor: Profile) -> dict:
        quote = await self._quote(quote_id)
        self._require_party(quote, actor)
        if quote.status != "accepted" and quote.chat_request_status != "accepted":
            raise AppError(
                error_codes.DEALER_CONTACT_WITHHELD, "Dealer contact remains private until the contact gate opens.", 403
            )
        dealer = await self.session.get(Profile, quote.dealer_id)
        return {
            "contact_available": True,
            "dealer": {
                "id": dealer.id,
                "name": dealer.full_name,
                "dealership_name": dealer.dealership_name,
                "phone": dealer.phone,
                "email": dealer.email,
            },
        }

    @log_flow(layer="service")
    async def request_chat(self, quote_id: str, payload: ChatRequestCreate, buyer: Profile) -> dict:
        self.validate_chat_message(payload.message)
        quote = await self._quote(quote_id)
        self._require_owner(quote.buyer_id, buyer.id)
        quote.chat_request_status = "pending"
        quote.chat_request_message = payload.message
        quote.chat_requested_at = datetime.now(UTC)
        await self.repository.commit()
        await self.session.refresh(quote)
        logger.info("chat_requested", quote_id=quote.id, buyer_id=buyer.id)
        return await self.quote_dict(quote)

    @log_flow(layer="service")
    async def accept_chat(self, quote_id: str, dealer: Profile) -> dict:
        quote = await self._quote(quote_id)
        self._require_owner(quote.dealer_id, dealer.id)
        if quote.chat_request_status != "pending":
            raise AppError(error_codes.ILLEGAL_TRANSITION, "This chat request is not pending.", 422)
        quote.chat_request_status = "accepted"
        quote.chat_decided_at = datetime.now(UTC)
        if quote.status == "pending":
            quote.status = "negotiating"
        self.repository.add(
            DealChat(
                quote_id=quote.id,
                sender_id=quote.buyer_id,
                message=quote.chat_request_message or "I would like to discuss this offer.",
            )
        )
        await self.repository.commit()
        await self.session.refresh(quote)
        logger.info("chat_accepted", quote_id=quote.id, dealer_id=dealer.id)
        return await self.quote_dict(quote)

    @log_flow(layer="service")
    async def chat_messages(self, quote_id: str, actor: Profile) -> list[dict]:
        quote = await self._quote(quote_id)
        self._require_party(quote, actor)
        if quote.status != "accepted" and quote.chat_request_status != "accepted":
            raise AppError(error_codes.CHAT_NOT_OPEN, "This conversation is not open.", 403)
        rows = [row for row in await self.repository.chat_messages(quote_id) if actor.id not in row.hidden_for]
        profiles = await self._profile_map({row.sender_id for row in rows})
        return [self._chat_message_dict(row, profiles.get(row.sender_id)) for row in rows]

    @log_flow(layer="service")
    async def send_chat(self, quote_id: str, payload: ChatSend, actor: Profile) -> dict:
        self.validate_chat_message(payload.message)
        quote = await self._quote(quote_id)
        self._require_party(quote, actor)
        if quote.status != "accepted" and quote.chat_request_status != "accepted":
            raise AppError(error_codes.CHAT_NOT_OPEN, "This conversation is not open.", 403)
        existing = next(
            (row for row in await self.repository.chat_messages(quote_id) if row.client_message_id == payload.id), None
        )
        if existing:
            sender = await self.session.get(Profile, existing.sender_id)
            return self._chat_message_dict(existing, sender)
        row = DealChat(quote_id=quote_id, sender_id=actor.id, message=payload.message, client_message_id=payload.id)
        self.repository.add(row)
        await self.repository.commit()
        await self.session.refresh(row)
        return self._chat_message_dict(row, actor)

    @staticmethod
    def validate_chat_message(message: str) -> None:
        if violates_chat_guidelines(message):
            raise AppError(error_codes.CHAT_GUIDELINE_VIOLATION, CHAT_GUIDELINE_MESSAGE, 422)

    @staticmethod
    def _chat_message_dict(row: DealChat, sender: Profile | None) -> dict:
        unsent = row.message == CHAT_UNSENT_MARKER
        return {
            **model_dict(row),
            "message": CHAT_UNSENT_TEXT if unsent else row.message,
            "sender_name": MarketplaceService._chat_sender_name(sender),
            "edited": row.updated_by == row.sender_id and not unsent,
            "unsent": unsent,
        }

    async def _owned_chat_message(self, quote_id: str, message_id: str, actor: Profile) -> DealChat:
        quote = await self._quote(quote_id)
        self._require_party(quote, actor)
        if quote.status != "accepted" and quote.chat_request_status != "accepted":
            raise AppError(error_codes.CHAT_NOT_OPEN, "This conversation is not open.", 403)
        row = await self.repository.chat_message_by_id(quote_id, message_id)
        if row is None or row.sender_id != actor.id:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Message not found.", 404)
        if row.message == CHAT_UNSENT_MARKER:
            raise AppError(error_codes.ILLEGAL_TRANSITION, "An unsent message can’t be changed again.", 409)
        return row

    @log_flow(layer="service")
    async def edit_chat_message(self, quote_id: str, message_id: str, payload: ChatEdit, actor: Profile) -> dict:
        self.validate_chat_message(payload.message)
        row = await self._owned_chat_message(quote_id, message_id, actor)
        row.message = payload.message.strip()
        row.updated_by = actor.id
        await self.repository.commit()
        await self.session.refresh(row)
        return self._chat_message_dict(row, actor)

    @log_flow(layer="service")
    async def unsend_chat_message(self, quote_id: str, message_id: str, actor: Profile) -> dict:
        row = await self._owned_chat_message(quote_id, message_id, actor)
        row.message = CHAT_UNSENT_MARKER
        row.updated_by = actor.id
        await self.repository.commit()
        await self.session.refresh(row)
        return self._chat_message_dict(row, actor)

    @log_flow(layer="service")
    async def update_deal_status(self, quote_id: str, payload: DealStatusUpdate, actor: Profile) -> dict:
        quote = await self._quote(quote_id)
        self._require_party(quote, actor)
        if quote.status != "accepted":
            raise AppError(error_codes.ILLEGAL_TRANSITION, "Only accepted quotes have a deal status.", 422)
        current = quote.deal_status
        allowed = payload.status == "cancelled" or (
            current in MARKETPLACE_DEAL_FLOW
            and MARKETPLACE_DEAL_FLOW.index(payload.status) == MARKETPLACE_DEAL_FLOW.index(current) + 1
        )
        if current is None:
            allowed = payload.status == "paperwork_going_on"
        if not allowed or current in {"completed", "cancelled"}:
            raise AppError(error_codes.ILLEGAL_TRANSITION, "That deal status transition is not allowed.", 422)
        quote.deal_status = payload.status
        quote.deal_history = [
            *quote.deal_history,
            {
                "ts": datetime.now(UTC).isoformat(),
                "actor_id": actor.id,
                "actor_role": actor.role,
                "event": "deal_status_changed",
                "from": current,
                "to": payload.status,
            },
        ]
        await self.repository.commit()
        await self.session.refresh(quote)
        logger.info(
            "deal_status_changed", quote_id=quote.id, actor_id=actor.id, from_status=current, to_status=payload.status
        )
        return await self.quote_dict(quote)

    @log_flow(layer="service")
    async def _request(self, request_id: str) -> BuyerRequest:
        row = await self.repository.request_by_id(request_id)
        if row is None:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Request not found.", 404)
        return row

    @log_flow(layer="service")
    async def _quote(self, quote_id: str) -> DealQuote:
        row = await self.repository.quote_by_id(quote_id)
        if row is None:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Quote not found.", 404)
        return row

    @staticmethod
    @log_flow(layer="service")
    def _require_owner(owner_id: str, actor_id: str) -> None:
        if owner_id != actor_id:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Resource not found.", 404)

    @staticmethod
    @log_flow(layer="service")
    def _require_party(quote: DealQuote, actor: Profile) -> None:
        if actor.role not in {"support", "support-admin", "admin"} and actor.id not in {
            quote.buyer_id,
            quote.dealer_id,
        }:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Resource not found.", 404)
