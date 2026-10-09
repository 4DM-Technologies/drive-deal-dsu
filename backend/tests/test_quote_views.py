import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from main import app
from src.database import SessionFactory
from src.repositories.schema import DealQuote
from tests.demo_data import IDS

BUYER = "rahul@drivedeal.demo"
DEALER = "naveen@naveemotors.demo"
QUOTE_ID = IDS["q1"]
REQUEST_ID = IDS["bronco"]


def login(client: TestClient, email: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def set_quote(quote_id: str, **values: object) -> None:
    async def _update() -> None:
        async with SessionFactory() as session:
            await session.execute(update(DealQuote).where(DealQuote.id == quote_id).values(**values))
            await session.commit()

    asyncio.run(_update())


def stored_quote(quote_id: str) -> DealQuote:
    async def _fetch() -> DealQuote:
        async with SessionFactory() as session:
            return (await session.execute(select(DealQuote).where(DealQuote.id == quote_id))).scalar_one()

    return asyncio.run(_fetch())


def seen_by_buyer(client: TestClient, dealer: dict[str, str], quote_id: str = QUOTE_ID) -> bool:
    quotes = client.get("/api/v1/quotes", headers=dealer).json()
    return next(quote for quote in quotes if quote["id"] == quote_id)["buyer_viewed"]


@pytest.fixture(autouse=True)
def unread_quote() -> None:
    """Every test starts with the seeded quote pending and not yet opened by its buyer."""
    set_quote(QUOTE_ID, status="pending", read_by_buyer=False)


def test_dealer_sees_a_quote_as_unviewed_until_the_buyer_opens_the_offers() -> None:
    with TestClient(app) as client:
        buyer, dealer = login(client, BUYER), login(client, DEALER)
        assert seen_by_buyer(client, dealer) is False

        # The unfiltered list also feeds dashboards and counters, so it is not a view of the offers.
        assert client.get("/api/v1/quotes", headers=buyer).status_code == 200
        assert seen_by_buyer(client, dealer) is False

        first = client.get(f"/api/v1/requests/{REQUEST_ID}/quotes", headers=buyer).json()
        assert next(quote for quote in first if quote["id"] == QUOTE_ID)["read_by_buyer"] is False
        assert seen_by_buyer(client, dealer) is True

        again = client.get("/api/v1/quotes", params={"request_id": REQUEST_ID}, headers=buyer).json()
        assert next(quote for quote in again if quote["id"] == QUOTE_ID)["read_by_buyer"] is True


def test_opening_the_offers_marks_every_quote_on_the_request_viewed() -> None:
    with TestClient(app) as client:
        buyer = login(client, BUYER)
        quotes = client.get(f"/api/v1/requests/{REQUEST_ID}/quotes", headers=buyer).json()
        assert len(quotes) == 3
    assert all(stored_quote(quote["id"]).read_by_buyer for quote in quotes)


def test_viewing_does_not_count_as_changing_the_quote() -> None:
    before = stored_quote(QUOTE_ID).updated_at
    with TestClient(app) as client:
        client.get(f"/api/v1/requests/{REQUEST_ID}/quotes", headers=login(client, BUYER))
    after = stored_quote(QUOTE_ID)
    assert after.read_by_buyer is True
    assert after.updated_at == before


def test_the_buyer_opening_a_single_quote_marks_it_viewed() -> None:
    with TestClient(app) as client:
        buyer, dealer = login(client, BUYER), login(client, DEALER)
        assert client.get(f"/api/v1/quotes/{QUOTE_ID}", headers=buyer).status_code == 200
        assert seen_by_buyer(client, dealer) is True


def test_the_dealer_looking_at_their_own_quote_is_not_a_buyer_view() -> None:
    with TestClient(app) as client:
        dealer = login(client, DEALER)
        assert client.get(f"/api/v1/quotes/{QUOTE_ID}", headers=dealer).status_code == 200
        client.get("/api/v1/quotes", params={"request_id": REQUEST_ID}, headers=dealer)
        assert seen_by_buyer(client, dealer) is False


def test_a_revised_quote_is_unviewed_until_the_buyer_opens_it_again() -> None:
    with TestClient(app) as client:
        buyer, dealer = login(client, BUYER), login(client, DEALER)
        client.get(f"/api/v1/requests/{REQUEST_ID}/quotes", headers=buyer)
        assert seen_by_buyer(client, dealer) is True

        revised = client.patch(f"/api/v1/quotes/{QUOTE_ID}/revise", headers=dealer, json={"vehicle_price": "64000"})
        assert revised.status_code == 200, revised.text
        assert seen_by_buyer(client, dealer) is False

        client.get(f"/api/v1/requests/{REQUEST_ID}/quotes", headers=buyer)
        assert seen_by_buyer(client, dealer) is True


@pytest.mark.parametrize("decision", ["accepted", "declined"])
def test_a_quote_the_buyer_decided_on_counts_as_viewed(decision: str) -> None:
    # Quotes decided before views were tracked have no read flag, but a decision proves the buyer saw them.
    set_quote(QUOTE_ID, status=decision, read_by_buyer=False)
    with TestClient(app) as client:
        assert seen_by_buyer(client, login(client, DEALER)) is True


def test_a_withdrawn_quote_the_buyer_never_opened_stays_unviewed() -> None:
    set_quote(QUOTE_ID, status="withdrawn", read_by_buyer=False)
    with TestClient(app) as client:
        assert seen_by_buyer(client, login(client, DEALER)) is False
