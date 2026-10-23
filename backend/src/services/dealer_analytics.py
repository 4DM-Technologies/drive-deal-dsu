"""Market insights for the dealer overview: where buyer demand is, what it asks for, and how the dealer is doing.

Market figures cover every open buyer request (the same set as the buyer feed); performance figures cover only the
calling dealer's own quotes. Location uses the request's state (chosen from the states list), not the free-text area,
so "austin,tx" and "Austin, Texas" count as the same place.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from statistics import median

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.schema import Brand, BuyerRequest, DealQuote, Profile, State
from src.services.marketplace_service import MarketplaceService
from src.utils.log_flow import log_flow

TREND_DAYS = 14
TIMELINE_ORDER = ("ASAP", "Within 1 week", "Within 2 weeks", "Just exploring")


def _utc(value: datetime) -> datetime:
    # SQLite hands back naive datetimes; everything is stored in UTC.
    return value if value.tzinfo else value.replace(tzinfo=UTC)


class DealerAnalyticsService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @log_flow(layer="service")
    async def overview(self, dealer: Profile) -> dict:
        # Count the market the way the feed shows it: requests past their no-quote month are closed first.
        await MarketplaceService(self.session)._expire_unquoted_requests()
        now = datetime.now(UTC)
        return {
            "generated_at": now.isoformat(),
            **await self._market(dealer, now),
            "performance": await self._performance(dealer),
        }

    async def _market(self, dealer: Profile, now: datetime) -> dict:
        is_open = BuyerRequest.status == "open"
        open_count = await self.session.scalar(select(func.count(BuyerRequest.id)).where(is_open)) or 0

        states = await self.session.execute(
            select(State.name, State.code, func.count(BuyerRequest.id))
            .join(State, State.id == BuyerRequest.buyer_area_state_id)
            .where(is_open)
            .group_by(State.name, State.code)
        )
        by_state = sorted(
            ({"state": name, "code": code, "count": count} for name, code, count in states),
            key=lambda row: (-row["count"], row["state"]),
        )

        mine_ids = set(dealer.supported_brands or [])
        mine_names = {name.casefold() for name in dealer.other_brands or []}
        brands = await self.session.execute(
            select(Brand.id, Brand.name, func.count(BuyerRequest.id))
            .join(Brand, Brand.id == BuyerRequest.brand_id)
            .where(is_open)
            .group_by(Brand.id, Brand.name)
        )
        by_brand = sorted(
            (
                {"brand": name, "count": count, "mine": brand_id in mine_ids or name.casefold() in mine_names}
                for brand_id, name, count in brands
            ),
            key=lambda row: (-row["count"], row["brand"]),
        )
        # The dealer's own brands that no open request asks for, named so the overview can say so plainly.
        demanded = {row["brand"].casefold() for row in by_brand}
        catalog_names = (
            (await self.session.execute(select(Brand.name).where(Brand.id.in_(mine_ids)))).scalars() if mine_ids else []
        )
        my_brands_without_requests = sorted(
            {name for name in [*catalog_names, *(dealer.other_brands or [])] if name.casefold() not in demanded},
            key=str.casefold,
        )

        timelines = dict(
            (
                await self.session.execute(
                    select(BuyerRequest.timeline, func.count(BuyerRequest.id))
                    .where(is_open)
                    .group_by(BuyerRequest.timeline)
                )
            ).all()
        )
        by_timeline = [{"timeline": timeline, "count": timelines.get(timeline, 0)} for timeline in TIMELINE_ORDER]

        # Days are bucketed here rather than in SQL, because date functions differ between SQLite and Postgres.
        today = now.date()
        first_day = today - timedelta(days=TREND_DAYS - 1)
        since = datetime.combine(today - timedelta(days=2 * 7 - 1), datetime.min.time(), tzinfo=UTC)
        created = (
            await self.session.execute(
                select(BuyerRequest.created_at).where(BuyerRequest.status != "draft", BuyerRequest.created_at >= since)
            )
        ).scalars()
        per_day: dict = {}
        for stamp in created:
            day = _utc(stamp).date()
            per_day[day] = per_day.get(day, 0) + 1
        daily = [
            {
                "date": (first_day + timedelta(days=offset)).isoformat(),
                "count": per_day.get(first_day + timedelta(days=offset), 0),
            }
            for offset in range(TREND_DAYS)
        ]
        last_7 = sum(per_day.get(today - timedelta(days=offset), 0) for offset in range(7))
        previous_7 = sum(per_day.get(today - timedelta(days=offset), 0) for offset in range(7, 14))

        return {
            "open_requests": open_count,
            "new_requests": {"last_7_days": last_7, "previous_7_days": previous_7},
            "daily_new_requests": daily,
            "by_state": by_state,
            "by_brand": by_brand,
            "my_brands_without_requests": my_brands_without_requests,
            "by_timeline": by_timeline,
        }

    async def _performance(self, dealer: Profile) -> dict:
        rows = (
            await self.session.execute(
                select(DealQuote, BuyerRequest.created_at)
                .join(BuyerRequest, BuyerRequest.id == DealQuote.buyer_request_id)
                .where(DealQuote.dealer_id == dealer.id, DealQuote.status != "withdrawn")
            )
        ).all()
        quotes = [quote for quote, _ in rows]
        accepted = [quote for quote in quotes if quote.status == "accepted"]
        declined = sum(1 for quote in quotes if quote.status == "declined")
        # Accepting or declining is proof the buyer saw the quote, as on the Quotes page.
        viewed = sum(1 for quote in quotes if quote.read_by_buyer or quote.status in {"accepted", "declined"})
        response_hours = [
            hours
            for quote, requested_at in rows
            if (hours := (_utc(quote.created_at) - _utc(requested_at)).total_seconds() / 3600) >= 0
        ]
        decided = len(accepted) + declined
        return {
            "quotes_sent": len(quotes),
            "accepted": len(accepted),
            "declined": declined,
            # Of the quotes buyers decided on, the share they accepted; null until a buyer has decided.
            "win_rate": round(len(accepted) / decided, 4) if decided else None,
            "buyer_view_rate": round(viewed / len(quotes), 4) if quotes else None,
            "median_response_hours": round(median(response_hours), 1) if response_hours else None,
            "accepted_value": f"{sum((quote.final_price for quote in accepted), Decimal('0')):.2f}",
        }
