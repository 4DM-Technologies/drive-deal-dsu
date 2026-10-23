from datetime import date

from fastapi.testclient import TestClient

from main import app
from src.services.dealer_analytics import TIMELINE_ORDER, TREND_DAYS

DEALER = "naveen@naveemotors.demo"
BUYER = "rahul@drivedeal.demo"


def login(client: TestClient, email: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_market_figures_add_up_to_the_open_feed() -> None:
    with TestClient(app) as client:
        dealer = login(client, DEALER)
        analytics = client.get("/api/v1/dealer/analytics", headers=dealer)
        feed = client.get("/api/v1/feed/requests", headers=dealer).json()
    assert analytics.status_code == 200, analytics.text
    body = analytics.json()

    assert body["open_requests"] == len(feed)
    # Every open request has a state, a brand and a timeline, so each breakdown covers the whole market.
    assert sum(row["count"] for row in body["by_state"]) == len(feed)
    assert sum(row["count"] for row in body["by_brand"]) == len(feed)
    assert [row["timeline"] for row in body["by_timeline"]] == list(TIMELINE_ORDER)
    assert sum(row["count"] for row in body["by_timeline"]) == len(feed)
    counts = [row["count"] for row in body["by_state"]]
    assert counts == sorted(counts, reverse=True)
    assert all(row["state"] and row["code"] for row in body["by_state"])


def test_trend_covers_the_last_fourteen_days_ending_today() -> None:
    with TestClient(app) as client:
        body = client.get("/api/v1/dealer/analytics", headers=login(client, DEALER)).json()
    days = [date.fromisoformat(row["date"]) for row in body["daily_new_requests"]]
    assert len(days) == TREND_DAYS
    assert days == sorted(days) and (days[-1] - days[0]).days == TREND_DAYS - 1
    # The demo data was created just now, so this week's new requests are all in the trend's last week.
    assert body["new_requests"]["last_7_days"] == sum(row["count"] for row in body["daily_new_requests"][-7:])
    assert body["new_requests"]["last_7_days"] > 0


def test_the_dealers_own_brands_are_marked() -> None:
    with TestClient(app) as client:
        body = client.get("/api/v1/dealer/analytics", headers=login(client, DEALER)).json()
    mine = {row["brand"] for row in body["by_brand"] if row["mine"]}
    # The demo dealer sells Ford, Honda and BMW; only brands with open requests appear in by_brand.
    assert mine and mine <= {"Ford", "Honda", "BMW"}
    # Each of the dealer's brands is either in demand or named as having no open requests, never both.
    without = set(body["my_brands_without_requests"])
    assert mine | without == {"Ford", "Honda", "BMW"} and not mine & without


def test_performance_matches_the_dealers_quotes() -> None:
    with TestClient(app) as client:
        dealer = login(client, DEALER)
        performance = client.get("/api/v1/dealer/analytics", headers=dealer).json()["performance"]
        quotes = [row for row in client.get("/api/v1/quotes", headers=dealer).json() if row["status"] != "withdrawn"]
    accepted = sum(1 for row in quotes if row["status"] == "accepted")
    declined = sum(1 for row in quotes if row["status"] == "declined")
    assert performance["quotes_sent"] == len(quotes)
    assert performance["accepted"] == accepted and performance["declined"] == declined
    if accepted + declined:
        assert performance["win_rate"] == round(accepted / (accepted + declined), 4)
    assert 0 <= performance["buyer_view_rate"] <= 1
    assert performance["median_response_hours"] is None or performance["median_response_hours"] >= 0


def test_only_dealers_see_market_insights() -> None:
    with TestClient(app) as client:
        assert client.get("/api/v1/dealer/analytics").status_code == 401
        assert client.get("/api/v1/dealer/analytics", headers=login(client, BUYER)).status_code == 403
