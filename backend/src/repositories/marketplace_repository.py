from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.schema import BuyerRequest, Car, DealChat, DealDocument, DealQuote


class MarketplaceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def buyer_requests(self, buyer_id: str) -> list[BuyerRequest]:
        result = await self.session.execute(select(BuyerRequest).where(BuyerRequest.buyer_id == buyer_id).order_by(BuyerRequest.created_at.desc()))
        return list(result.scalars())

    async def request_feed(self) -> list[BuyerRequest]:
        result = await self.session.execute(select(BuyerRequest).where(BuyerRequest.status == "open").order_by(BuyerRequest.created_at.desc()))
        return list(result.scalars())

    async def request_by_id(self, request_id: str) -> BuyerRequest | None:
        return await self.session.get(BuyerRequest, request_id)

    async def quotes_for_request(self, request_id: str) -> list[DealQuote]:
        result = await self.session.execute(select(DealQuote).where(DealQuote.buyer_request_id == request_id).order_by(DealQuote.final_price, DealQuote.created_at))
        return list(result.scalars())

    async def quotes_for_dealer(self, dealer_id: str) -> list[DealQuote]:
        result = await self.session.execute(select(DealQuote).where(DealQuote.dealer_id == dealer_id).order_by(DealQuote.created_at.desc()))
        return list(result.scalars())

    async def quote_by_id(self, quote_id: str) -> DealQuote | None:
        return await self.session.get(DealQuote, quote_id)

    async def chat_messages(self, quote_id: str) -> list[DealChat]:
        result = await self.session.execute(select(DealChat).where(DealChat.quote_id == quote_id).order_by(DealChat.created_at))
        return list(result.scalars())

    async def document_by_id(self, document_id: str) -> DealDocument | None:
        return await self.session.get(DealDocument, document_id)

    async def cars_for_dealer(self, dealer_id: str) -> list[Car]:
        result = await self.session.execute(select(Car).where(Car.seller_id == dealer_id).order_by(Car.created_at.desc()))
        return list(result.scalars())

    async def all_cars(self) -> list[Car]:
        result = await self.session.execute(select(Car).where(Car.status == "available").order_by(Car.created_at.desc()))
        return list(result.scalars())

    def add(self, instance) -> None:
        self.session.add(instance)

    async def commit(self) -> None:
        await self.session.commit()
