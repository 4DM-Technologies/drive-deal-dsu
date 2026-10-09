from datetime import datetime

from sqlalchemy import func, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.schema import BuyerRequest, BuyerRequestView, Car, DealChat, DealDocument, DealQuote
from src.utils.log_flow import log_flow


class MarketplaceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @log_flow(layer="repository")
    async def buyer_requests(self, buyer_id: str) -> list[BuyerRequest]:
        result = await self.session.execute(
            select(BuyerRequest).where(BuyerRequest.buyer_id == buyer_id).order_by(BuyerRequest.created_at.desc())
        )
        return list(result.scalars())

    @log_flow(layer="repository")
    async def request_feed(self) -> list[BuyerRequest]:
        result = await self.session.execute(
            select(BuyerRequest).where(BuyerRequest.status == "open").order_by(BuyerRequest.created_at.desc())
        )
        return list(result.scalars())

    @log_flow(layer="repository")
    async def request_by_id(self, request_id: str) -> BuyerRequest | None:
        return await self.session.get(BuyerRequest, request_id)

    @log_flow(layer="repository")
    async def record_request_view(self, request_id: str, dealer_id: str, viewed_at: datetime) -> None:
        row = (
            await self.session.execute(
                select(BuyerRequestView).where(
                    BuyerRequestView.buyer_request_id == request_id,
                    BuyerRequestView.dealer_id == dealer_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            self.session.add(
                BuyerRequestView(
                    buyer_request_id=request_id,
                    dealer_id=dealer_id,
                    first_viewed_at=viewed_at,
                    last_viewed_at=viewed_at,
                )
            )
        else:
            row.last_viewed_at = viewed_at
        await self.session.commit()

    @log_flow(layer="repository")
    async def request_activity_counts(self, request_ids: list[str]) -> dict[str, dict[str, int]]:
        counts = {request_id: {"view_count": 0, "quote_count": 0} for request_id in request_ids}
        if not request_ids:
            return counts
        # A submitted quote is definitive proof that the dealership viewed the
        # request. Union it with explicit opens so older marketplace data and
        # newly tracked views produce one honest unique-dealer count.
        dealer_activity = union_all(
            select(
                BuyerRequestView.buyer_request_id.label("request_id"), BuyerRequestView.dealer_id.label("dealer_id")
            ).where(BuyerRequestView.buyer_request_id.in_(request_ids)),
            select(DealQuote.buyer_request_id.label("request_id"), DealQuote.dealer_id.label("dealer_id")).where(
                DealQuote.buyer_request_id.in_(request_ids), DealQuote.status != "withdrawn"
            ),
        ).subquery()
        view_rows = await self.session.execute(
            select(dealer_activity.c.request_id, func.count(func.distinct(dealer_activity.c.dealer_id))).group_by(
                dealer_activity.c.request_id
            )
        )
        quote_rows = await self.session.execute(
            select(DealQuote.buyer_request_id, func.count(DealQuote.id))
            .where(DealQuote.buyer_request_id.in_(request_ids), DealQuote.status != "withdrawn")
            .group_by(DealQuote.buyer_request_id)
        )
        for request_id, count in view_rows:
            counts[request_id]["view_count"] = int(count)
        for request_id, count in quote_rows:
            counts[request_id]["quote_count"] = int(count)
        return counts

    @log_flow(layer="repository")
    async def quotes_for_request(self, request_id: str) -> list[DealQuote]:
        result = await self.session.execute(
            select(DealQuote)
            .where(DealQuote.buyer_request_id == request_id)
            .order_by(DealQuote.final_price, DealQuote.created_at)
        )
        return list(result.scalars())

    @log_flow(layer="repository")
    async def dealer_has_quote_for_request(self, dealer_id: str, request_id: str) -> bool:
        result = await self.session.execute(
            select(DealQuote.id)
            .where(
                DealQuote.dealer_id == dealer_id,
                DealQuote.buyer_request_id == request_id,
            )
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    @log_flow(layer="repository")
    async def quotes_for_requests(self, request_ids: list[str]) -> list[DealQuote]:
        if not request_ids:
            return []
        result = await self.session.execute(
            select(DealQuote)
            .where(DealQuote.buyer_request_id.in_(request_ids))
            .order_by(DealQuote.final_price, DealQuote.created_at)
        )
        return list(result.scalars())

    @log_flow(layer="repository")
    async def quotes_for_dealer(self, dealer_id: str) -> list[DealQuote]:
        result = await self.session.execute(
            select(DealQuote).where(DealQuote.dealer_id == dealer_id).order_by(DealQuote.created_at.desc())
        )
        return list(result.scalars())

    @log_flow(layer="repository")
    async def quote_by_id(self, quote_id: str) -> DealQuote | None:
        return await self.session.get(DealQuote, quote_id)

    @log_flow(layer="repository")
    async def chat_messages(self, quote_id: str) -> list[DealChat]:
        result = await self.session.execute(
            select(DealChat).where(DealChat.quote_id == quote_id).order_by(DealChat.created_at)
        )
        return list(result.scalars())

    @log_flow(layer="repository")
    async def chat_message_by_id(self, quote_id: str, message_id: str) -> DealChat | None:
        result = await self.session.execute(
            select(DealChat).where(DealChat.quote_id == quote_id, DealChat.id == message_id)
        )
        return result.scalar_one_or_none()

    @log_flow(layer="repository")
    async def document_by_id(self, document_id: str) -> DealDocument | None:
        return await self.session.get(DealDocument, document_id)

    @log_flow(layer="repository")
    async def cars_for_dealer(self, dealer_id: str) -> list[Car]:
        result = await self.session.execute(
            select(Car).where(Car.created_by == dealer_id).order_by(Car.created_at.desc())
        )
        return list(result.scalars())

    @log_flow(layer="repository")
    async def all_cars(self) -> list[Car]:
        result = await self.session.execute(
            select(Car).where(Car.status == "available").order_by(Car.created_at.desc())
        )
        return list(result.scalars())

    @log_flow(layer="repository")
    def add(self, instance) -> None:
        self.session.add(instance)

    @log_flow(layer="repository")
    async def commit(self) -> None:
        await self.session.commit()
