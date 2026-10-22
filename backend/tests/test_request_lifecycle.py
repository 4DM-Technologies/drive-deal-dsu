import asyncio
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select, update

from main import app
from src.database import SessionFactory
from src.repositories.schema import BuyerRequest, DealQuote
from tests.demo_data import IDS

BUYER = "rahul@drivedeal.demo"
DEALER = "naveen@naveemotors.demo"


def login(client: TestClient, email: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def unquoted_request_id() -> str:
    """The buyer's open CR-V brief with every dealer's quote withdrawn, which leaves it with no live quotes."""

    async def _fetch() -> str:
        async with SessionFactory() as session:
            request_id = (
                (
                    await session.execute(
                        select(BuyerRequest.id).where(
                            BuyerRequest.buyer_id == IDS["buyer"],
                            BuyerRequest.model == "CR-V",
                            BuyerRequest.status == "open",
                        )
                    )
                )
                .scalars()
                .first()
            )
            await session.execute(
                update(DealQuote).where(DealQuote.buyer_request_id == request_id).values(status="withdrawn")
            )
            await session.commit()
            return request_id

    return asyncio.run(_fetch())


def posted_days_ago(request_id: str, days: int) -> None:
    async def _update() -> None:
        async with SessionFactory() as session:
            await session.execute(
                update(BuyerRequest)
                .where(BuyerRequest.id == request_id)
                .values(created_at=datetime.now(UTC) - timedelta(days=days))
            )
            await session.commit()

    asyncio.run(_update())


def buyer_request(client: TestClient, headers: dict[str, str], request_id: str) -> dict:
    return next(row for row in client.get("/api/v1/requests", headers=headers).json() if row["id"] == request_id)


def feed_ids(client: TestClient, headers: dict[str, str]) -> list[str]:
    return [row["id"] for row in client.get("/api/v1/feed/requests", headers=headers).json()]


def test_fresh_request_cannot_be_notified_or_repushed() -> None:
    request_id = unquoted_request_id()
    with TestClient(app) as client:
        buyer = login(client, BUYER)
        row = buyer_request(client, buyer, request_id)
        assert row["created_at"]
        assert row["can_notify_dealers"] is False and row["can_repush"] is False
        assert client.post(f"/api/v1/requests/{request_id}/notify-dealers", headers=buyer).status_code == 409
        assert client.post(f"/api/v1/requests/{request_id}/repush", headers=buyer).status_code == 409


def test_buyer_notifies_dealers_once_after_two_weeks_without_quotes() -> None:
    request_id = unquoted_request_id()
    posted_days_ago(request_id, 15)
    with TestClient(app) as client:
        buyer, dealer = login(client, BUYER), login(client, DEALER)
        assert buyer_request(client, buyer, request_id)["can_notify_dealers"] is True
        assert feed_ids(client, dealer)[0] != request_id

        notified = client.post(f"/api/v1/requests/{request_id}/notify-dealers", headers=buyer)
        assert notified.status_code == 200, notified.text
        assert notified.json()["dealers_notified_at"] and notified.json()["can_notify_dealers"] is False
        assert client.post(f"/api/v1/requests/{request_id}/notify-dealers", headers=buyer).status_code == 409

        feed = client.get("/api/v1/feed/requests", headers=dealer).json()
        assert feed[0]["id"] == request_id and feed[0]["dealers_notified_at"]


def test_request_with_quotes_is_never_notified_or_closed() -> None:
    posted_days_ago(IDS["bronco"], 40)
    with TestClient(app) as client:
        row = buyer_request(client, login(client, BUYER), IDS["bronco"])
        assert row["status"] == "open" and row["can_notify_dealers"] is False


def test_unquoted_request_closes_after_a_month_and_repush_reopens_it() -> None:
    request_id = unquoted_request_id()
    posted_days_ago(request_id, 31)
    with TestClient(app) as client:
        buyer, dealer = login(client, BUYER), login(client, DEALER)
        closed = buyer_request(client, buyer, request_id)
        assert closed["status"] == "expired" and closed["can_repush"] is True
        assert request_id not in feed_ids(client, dealer)
        assert client.post(f"/api/v1/requests/{request_id}/notify-dealers", headers=buyer).status_code == 409

        repushed = client.post(f"/api/v1/requests/{request_id}/repush", headers=buyer)
        assert repushed.status_code == 200, repushed.text
        body = repushed.json()
        assert body["status"] == "open" and body["repushed_at"]
        # The clocks restart from the repush, so it is neither closed nor due a reminder again.
        assert body["can_repush"] is False and body["can_notify_dealers"] is False
        assert buyer_request(client, buyer, request_id)["status"] == "open"

        feed = client.get("/api/v1/feed/requests", headers=dealer).json()
        assert feed[0]["id"] == request_id and feed[0]["repushed_at"]


def test_only_the_owner_can_notify_or_repush() -> None:
    request_id = unquoted_request_id()
    posted_days_ago(request_id, 15)
    with TestClient(app) as client:
        dealer = login(client, DEALER)
        assert client.post(f"/api/v1/requests/{request_id}/notify-dealers", headers=dealer).status_code == 403
