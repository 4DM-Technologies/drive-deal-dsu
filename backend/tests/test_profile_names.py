from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from main import app
from tests.demo_data import IDS, PDF_BYTES, PNG_BYTES

SIGNUP_URL = "/api/v1/auth/signup/buyer"


def signup(client: TestClient, **overrides: str):
    fields = {
        "first_name": "Ava",
        "last_name": "Patel",
        "email": f"names-{uuid4().hex[:8]}@example.com",
        "phone": "+12145550999",
        "password": "secure-demo-password",
        "state_id": IDS["tx"],
        "terms_accepted": "true",
        "terms_version": "2026-09-30",
        **overrides,
    }
    return client.post(SIGNUP_URL, data=fields, files={"driving_license": ("licence.png", PNG_BYTES, "image/png")})


def auth(tokens: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def test_buyer_signup_stores_first_and_last_name_and_builds_the_display_name() -> None:
    with TestClient(app) as client:
        response = signup(client, first_name="  Ava ", last_name=" Patel  ")
        assert response.status_code == 201, response.text
        profile = response.json()["profile"]
        assert (profile["first_name"], profile["last_name"], profile["full_name"]) == ("Ava", "Patel", "Ava Patel")

        me = client.get("/api/v1/profiles/me", headers=auth(response.json()))
        assert me.status_code == 200
        assert (me.json()["first_name"], me.json()["last_name"], me.json()["full_name"]) == (
            "Ava",
            "Patel",
            "Ava Patel",
        )


def test_buyer_signup_requires_both_names() -> None:
    with TestClient(app) as client:
        assert signup(client, last_name="   ").status_code == 422
        assert signup(client, first_name="").status_code == 422
        assert signup(client, first_name="A" * 76).status_code == 422


def test_profile_update_keeps_the_display_name_in_step_with_the_name_parts() -> None:
    with TestClient(app) as client:
        tokens = signup(client).json()

        renamed = client.patch("/api/v1/profiles/me", headers=auth(tokens), json={"last_name": "Shah"})
        assert renamed.status_code == 200, renamed.text
        assert (renamed.json()["first_name"], renamed.json()["last_name"], renamed.json()["full_name"]) == (
            "Ava",
            "Shah",
            "Ava Shah",
        )

        cleared = client.patch(
            "/api/v1/profiles/me", headers=auth(tokens), json={"first_name": "Ava Rose", "last_name": ""}
        )
        assert cleared.status_code == 200, cleared.text
        assert (cleared.json()["last_name"], cleared.json()["full_name"]) == (None, "Ava Rose")

        assert client.patch("/api/v1/profiles/me", headers=auth(tokens), json={"first_name": "  "}).status_code == 422


def login(client: TestClient, email: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert response.status_code == 200, response.text
    return auth(response.json())


def test_dealer_quote_list_shows_each_buyers_first_name_only() -> None:
    with TestClient(app) as client:
        quotes = client.get("/api/v1/quotes", headers=login(client, "naveen@naveemotors.demo"))
        assert quotes.status_code == 200, quotes.text
        rows = quotes.json()
        assert rows and all("buyer_first_name" in row for row in rows)
        assert "Rahul" in {row["buyer_first_name"] for row in rows}
        # Only the first name: the rest of the buyer's identity stays out of the list.
        assert not any(key in row for row in rows for key in ("buyer_last_name", "buyer_email", "buyer_phone"))

        buyer_view = client.get("/api/v1/quotes", headers=login(client, "rahul@drivedeal.demo"))
        assert buyer_view.status_code == 200
        assert all("buyer_first_name" not in row for row in buyer_view.json())


def test_dealer_gets_buyer_first_name_and_phone_only_once_contact_opens() -> None:
    with TestClient(app) as client:
        dealer = login(client, "naveen@naveemotors.demo")
        rows = client.get("/api/v1/quotes", headers=dealer).json()
        opened = [row for row in rows if row["status"] == "accepted" or row["chat_request_status"] == "accepted"]
        closed = [row for row in rows if row not in opened]
        assert opened and closed

        contact = client.get(f"/api/v1/quotes/{opened[0]['id']}/buyer-contact", headers=dealer)
        assert contact.status_code == 200, contact.text
        assert set(contact.json()["buyer"]) == {"id", "first_name", "phone"}
        assert contact.json()["buyer"]["phone"]

        assert client.get(f"/api/v1/quotes/{closed[0]['id']}/buyer-contact", headers=dealer).status_code == 403
        other_dealer = login(client, "elena@lonestar.demo")
        assert client.get(f"/api/v1/quotes/{opened[0]['id']}/buyer-contact", headers=other_dealer).status_code == 404


def test_dealer_signup_website_is_optional_but_still_checked_when_given(local_uploads: Path) -> None:
    def dealer(**website: str) -> dict:
        suffix = uuid4().hex[:8]
        return {
            "full_name": "Rajesh Kumar",
            "email": f"dealer-{suffix}@example.com",
            "phone": "+12145550999",
            "password": "secure-demo-password",
            "state_id": IDS["tx"],
            "address": "Dallas, TX",
            "terms_accepted": "true",
            "terms_version": "2026-09-30",
            "dealership_name": "Rajesh Motors",
            "branch_name": "Dallas",
            "dealer_license": f"TX-{suffix}",
            "supported_brand_ids": [IDS["ford"]],
            **website,
        }

    def apply(client: TestClient, fields: dict) -> int:
        licence = {"motor_vehicle_dealer_license": ("licence.pdf", PDF_BYTES, "application/pdf")}
        return client.post("/api/v1/auth/signup/dealer", data=fields, files=licence).status_code

    with TestClient(app) as client:
        assert apply(client, dealer()) == 202
        assert apply(client, dealer(website="  ")) == 202
        assert apply(client, dealer(website="https://rajesh.example")) == 202
        assert apply(client, dealer(website="not a url")) == 422
