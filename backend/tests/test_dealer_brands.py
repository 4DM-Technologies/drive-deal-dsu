import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import select, update

from main import app
from src.database import SessionFactory
from src.repositories.schema import Brand, Profile
from tests.demo_data import IDS
from tests.test_dealer_license import SIGNUP_URL, dealer_fields, licence_file, new_email

DEALER = "naveen@naveemotors.demo"
BUYER = "rahul@drivedeal.demo"
SUPPORT_ADMIN = "priya@drivedeal.demo"


def login(client: TestClient, email: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def stored_brands(email: str) -> tuple[list[str], list[str]]:
    async def _fetch():
        async with SessionFactory() as session:
            profile = await session.scalar(select(Profile).where(Profile.email == email))
            return profile.supported_brands, profile.other_brands

    return asyncio.run(_fetch())


def reset_dealer_brands() -> None:
    async def _reset():
        async with SessionFactory() as session:
            await session.execute(
                update(Profile)
                .where(Profile.email == DEALER)
                .values(supported_brands=[IDS["ford"], IDS["honda"], IDS["bmw"]], other_brands=[])
            )
            await session.commit()

    asyncio.run(_reset())


def ford_name() -> str:
    async def _fetch():
        async with SessionFactory() as session:
            return (await session.get(Brand, IDS["ford"])).name

    return asyncio.run(_fetch())


def test_dealer_signs_up_with_several_brands_and_other_brands() -> None:
    email = new_email()
    fields = dealer_fields(
        email,
        {
            "supported_brand_ids": [IDS["ford"], IDS["honda"], IDS["ford"]],
            # A typed name that is already in the catalog is stored as that brand, not as an "other" brand.
            "other_brands": ["  Rivian ", "rivian", ford_name().upper(), "Lucid Motors"],
        },
    )
    with TestClient(app) as client:
        response = client.post(SIGNUP_URL, data=fields, files=licence_file())
    assert response.status_code == 202, response.text
    assert stored_brands(email) == ([IDS["ford"], IDS["honda"]], ["Rivian", "Lucid Motors"])


def test_signup_needs_a_real_brand() -> None:
    with TestClient(app) as client:
        nothing = dealer_fields(new_email(), {"supported_brand_ids": []})
        assert client.post(SIGNUP_URL, data=nothing, files=licence_file()).status_code == 422
        unknown = dealer_fields(new_email(), {"supported_brand_ids": ["not-a-brand"]})
        assert client.post(SIGNUP_URL, data=unknown, files=licence_file()).status_code == 422
        too_short = dealer_fields(new_email(), {"supported_brand_ids": [], "other_brands": ["x"]})
        assert client.post(SIGNUP_URL, data=too_short, files=licence_file()).status_code == 422
        only_other = dealer_fields(new_email(), {"supported_brand_ids": [], "other_brands": ["Polestar"]})
        assert client.post(SIGNUP_URL, data=only_other, files=licence_file()).status_code == 202


def test_dealer_changes_brands_on_their_profile() -> None:
    reset_dealer_brands()
    try:
        with TestClient(app) as client:
            dealer = login(client, DEALER)
            response = client.patch(
                "/api/v1/profiles/me",
                headers=dealer,
                json={"supported_brands": [IDS["bmw"]], "other_brands": ["Polestar"]},
            )
            assert response.status_code == 200, response.text
            assert response.json()["supported_brands"] == [IDS["bmw"]]
            assert response.json()["other_brands"] == ["Polestar"]

            # Sending one list leaves the other as it was; an empty list clears it.
            response = client.patch("/api/v1/profiles/me", headers=dealer, json={"other_brands": []})
            assert response.json()["supported_brands"] == [IDS["bmw"]] and response.json()["other_brands"] == []
            me = client.get("/api/v1/profiles/me", headers=dealer).json()
            assert me["supported_brands"] == [IDS["bmw"]]

            empty = client.patch("/api/v1/profiles/me", headers=dealer, json={"supported_brands": []})
            assert empty.status_code == 422
            unknown = client.patch("/api/v1/profiles/me", headers=dealer, json={"supported_brands": ["nope"]})
            assert unknown.status_code == 422
    finally:
        reset_dealer_brands()


def test_buyers_have_no_brands_to_change() -> None:
    with TestClient(app) as client:
        response = client.patch(
            "/api/v1/profiles/me", headers=login(client, BUYER), json={"supported_brands": [IDS["ford"]]}
        )
    assert response.status_code == 403


def test_support_sees_brand_names_and_other_brands_on_the_application() -> None:
    email = new_email()
    fields = dealer_fields(email, {"supported_brand_ids": [IDS["ford"]], "other_brands": ["Rivian"]})
    with TestClient(app) as client:
        assert client.post(SIGNUP_URL, data=fields, files=licence_file()).status_code == 202
        verifications = client.get("/api/v1/verifications", headers=login(client, SUPPORT_ADMIN)).json()
    application = next(row for row in verifications if row["email"] == email)
    assert application["supported_brand_names"] == [ford_name()]
    assert application["other_brands"] == ["Rivian"]
