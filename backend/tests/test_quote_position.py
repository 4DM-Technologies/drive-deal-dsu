from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from main import app
from tests.demo_data import IDS


def login(client: TestClient, email: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def open_request(client: TestClient, buyer: dict[str, str]) -> str:
    payload = {
        "brand_id": IDS["ford"],
        "buyer_area_state_id": IDS["tx"],
        "model": "Bronco",
        "body_type": "SUV",
        "year_min": 2025,
        "year_max": 2026,
        "budget_max": "62000",
        "target_otd_price": "60000",
        "buyer_area": "Frisco, TX",
        "search_radius_miles": 50,
        "timeline": "Within 2 weeks",
        "condition": "new",
        "must_haves": [],
        "request_expire": (datetime.now(UTC) + timedelta(days=10)).isoformat(),
        "status": "draft",
    }
    created = client.post("/api/v1/requests", headers=buyer, json=payload)
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    assert client.post(f"/api/v1/requests/{request_id}/publish", headers=buyer).status_code == 200
    return request_id


def quote(client: TestClient, dealer: dict[str, str], request_id: str, vehicle_price: str) -> str:
    response = client.post(
        "/api/v1/quotes",
        headers=dealer,
        json={
            "buyer_request_id": request_id,
            "vehicle_price": vehicle_price,
            "doc_fee": "500",
            "sales_tax": "1000",
            "title_reg": "250",
            "trade_in_credit": "0",
            "message": "Available now",
            "expires_at": (datetime.now(UTC) + timedelta(days=3)).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def position(client: TestClient, dealer: dict[str, str], quote_id: str) -> dict:
    response = client.get(f"/api/v1/quotes/{quote_id}/position", headers=dealer)
    assert response.status_code == 200, response.text
    return response.json()


def test_each_dealer_sees_its_real_rank_on_the_request_not_across_its_own_quotes() -> None:
    with TestClient(app) as client:
        buyer = login(client, "rahul@drivedeal.demo")
        request_id = open_request(client, buyer)
        navee = login(client, "naveen@naveemotors.demo")
        lonestar = login(client, "elena@lonestar.demo")
        navee_quote = quote(client, navee, request_id, "6000")  # 7,750 out the door
        lonestar_quote = quote(client, lonestar, request_id, "32000")  # 33,750 out the door

        leading = position(client, navee, navee_quote)
        behind = position(client, lonestar, lonestar_quote)
        # Two offers on this request, whatever else each dealer has quoted elsewhere.
        assert (leading["rank"], leading["total"], leading["lead_by"], leading["behind_by"]) == (1, 2, "26000.00", None)
        assert (behind["rank"], behind["total"], behind["lead_by"], behind["behind_by"]) == (2, 2, None, "26000.00")

        # The buyer's leaderboard agrees: lowest out-the-door first.
        board = client.get(f"/api/v1/requests/{request_id}/quotes", headers=buyer).json()
        assert [row["id"] for row in sorted(board, key=lambda row: float(row["final_price"]))] == [
            navee_quote,
            lonestar_quote,
        ]

        # A revision that undercuts the leader takes first place for that dealer, and the other dealer drops back.
        revised = client.patch(
            f"/api/v1/quotes/{lonestar_quote}/revise", headers=lonestar, json={"vehicle_price": "5000"}
        )
        assert revised.status_code == 200, revised.text
        assert position(client, lonestar, lonestar_quote)["rank"] == 1
        assert position(client, navee, navee_quote)["rank"] == 2


def test_position_is_private_to_the_quoting_dealer_and_ignores_offers_out_of_play() -> None:
    with TestClient(app) as client:
        buyer = login(client, "rahul@drivedeal.demo")
        request_id = open_request(client, buyer)
        navee = login(client, "naveen@naveemotors.demo")
        lonestar = login(client, "elena@lonestar.demo")
        navee_quote = quote(client, navee, request_id, "6000")
        lonestar_quote = quote(client, lonestar, request_id, "32000")

        assert client.get(f"/api/v1/quotes/{navee_quote}/position", headers=lonestar).status_code == 404
        assert client.get(f"/api/v1/quotes/{navee_quote}/position", headers=buyer).status_code == 404

        assert client.post(f"/api/v1/quotes/{navee_quote}/withdraw", headers=navee).status_code == 200
        alone = position(client, lonestar, lonestar_quote)
        assert (alone["rank"], alone["total"], alone["lead_by"]) == (1, 1, None)
        assert position(client, navee, navee_quote)["rank"] is None
