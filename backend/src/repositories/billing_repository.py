from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.schema import BuyerRequest, DealQuote, Payment
from src.utils.log_flow import log_flow


class BillingRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @log_flow(layer="repository")
    async def quote_count(self, dealer_id: str) -> int:
        result = await self.session.execute(select(func.count(DealQuote.id)).where(DealQuote.dealer_id == dealer_id))
        return int(result.scalar_one())

    @log_flow(layer="repository")
    async def request_count(self, buyer_id: str) -> int:
        result = await self.session.execute(
            select(func.count(BuyerRequest.id)).where(BuyerRequest.buyer_id == buyer_id)
        )
        return int(result.scalar_one())

    @log_flow(layer="repository")
    def add_payment(self, payment: Payment) -> None:
        self.session.add(payment)

    @log_flow(layer="repository")
    async def commit(self) -> None:
        await self.session.commit()
