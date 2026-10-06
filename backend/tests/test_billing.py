import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from main import app
from src.auth.security import hash_password
from src.database import SessionFactory
from src.repositories.schema import Payment, Profile, User
from src.settings import DEALER_TRIAL_DAYS
from tests.demo_data import IDS

CARD = {
    "payment_method": "credit_card",
    "card_number": "4111111111111111",
    "cardholder_name": "Demo Subscriber",
    "expiry_month": 12,
    "expiry_year": 2029,
    "cvv": "123",
}


def login(client: TestClient, email: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def create_account(
    role: str,
    *,
    trial_expires_at: datetime | None = None,
    premium_expires_at: datetime | None = None,
) -> tuple[str, str]:
    """Insert an isolated buyer or dealer with a known entitlement state. Returns (profile_id, email)."""
    suffix = uuid4().hex[:8]
    email = f"billing-{role}-{suffix}@drivedeal.demo"
    now = datetime.now(UTC)

    async def _create() -> str:
        async with SessionFactory() as session:
            profile = Profile(
                state_id=IDS["tx"],
                full_name="Billing Demo Account",
                email=email,
                role=role,
                phone="+12145550000",
                address="Dallas, TX",
                terms_accepted=True,
                terms_version="2026-09-30",
                terms_accepted_at=now,
                trial_expires_at=trial_expires_at,
                trial_started_at=(trial_expires_at - timedelta(days=DEALER_TRIAL_DAYS)) if trial_expires_at else None,
                is_premium=premium_expires_at is not None,
                premium_expires_at=premium_expires_at,
            )
            if role == "dealer":
                profile.dealership_name = "Billing Motors"
                profile.branch_name = "Dallas"
                profile.dealer_license = f"TX-DLR-{suffix}"
            session.add(profile)
            await session.flush()
            session.add(User(profile_id=profile.id, password_hash=hash_password("demo1234"), is_active=True))
            await session.commit()
            return str(profile.id)

    return asyncio.run(_create()), email


def fetch_payments(profile_id: str) -> list[Payment]:
    async def _fetch() -> list[Payment]:
        async with SessionFactory() as session:
            result = await session.execute(select(Payment).where(Payment.profile_id == profile_id))
            return list(result.scalars())

    return asyncio.run(_fetch())


def request_payload() -> dict:
    return {
        "brand_id": IDS["ford"],
        "buyer_area_state_id": IDS["tx"],
        "model": "Explorer",
        "body_type": "SUV",
        "year_min": 2025,
        "year_max": 2026,
        "budget_max": "62000",
        "target_otd_price": "60000",
        "buyer_area": "Frisco, TX",
        "search_radius_miles": 50,
        "timeline": "Within 2 weeks",
        "condition": "new",
        "must_haves": ["AWD"],
        "request_expire": (datetime.now(UTC) + timedelta(days=10)).isoformat(),
        "status": "draft",
    }


def create_request(client: TestClient, headers: dict[str, str], *, publish: bool = True) -> str:
    created = client.post("/api/v1/requests", headers=headers, json=request_payload())
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    if publish:
        published = client.post(f"/api/v1/requests/{request_id}/publish", headers=headers)
        assert published.status_code == 200, published.text
    return request_id


def create_quote(client: TestClient, headers: dict[str, str], request_id: str):
    return client.post(
        "/api/v1/quotes",
        headers=headers,
        json={
            "buyer_request_id": request_id,
            "vehicle_price": "56000",
            "doc_fee": "500",
            "sales_tax": "3500",
            "title_reg": "225",
            "trade_in_credit": "0",
            "message": "Available now",
            "expires_at": (datetime.now(UTC) + timedelta(days=3)).isoformat(),
        },
    )


def test_dealer_trial_stamps_on_first_login_and_reports_subscription() -> None:
    _, email = create_account("dealer")
    with TestClient(app) as client:
        headers = login(client, email)
        subscription = client.get("/api/v1/auth/me", headers=headers).json()["subscription"]
        assert subscription["plan"] == "trial"
        assert subscription["quote_limit"] == 3
        assert subscription["quotes_used"] == 0
        assert subscription["quotes_remaining"] == 3
        assert subscription["can_quote"] is True
        assert subscription["premium_price"] == "500.00"
        assert subscription["currency"] == "USD"
        started = subscription["trial_started_at"]
        trial_expiry = datetime.fromisoformat(subscription["trial_expires_at"])
        assert datetime.now(UTC) + timedelta(days=59) < trial_expiry < datetime.now(UTC) + timedelta(days=61)
        assert client.get("/api/v1/profiles/me", headers=headers).json()["subscription"]["plan"] == "trial"

        login(client, email)
        again = client.get("/api/v1/auth/me", headers=headers).json()["subscription"]
        assert again["trial_started_at"] == started


def test_trial_allows_three_quotes_then_blocks_until_payment() -> None:
    _, buyer_email = create_account("buyer")
    _, second_buyer_email = create_account("buyer")
    _, dealer_email = create_account("dealer")
    with TestClient(app) as client:
        buyer = login(client, buyer_email)
        dealer = login(client, dealer_email)
        for _ in range(3):
            assert create_quote(client, dealer, create_request(client, buyer)).status_code == 201

        extra_request = create_request(client, login(client, second_buyer_email))
        blocked = create_quote(client, dealer, extra_request)
        assert blocked.status_code == 402, blocked.text
        error = blocked.json()["error"]
        assert error["code"] == "SUBSCRIPTION_REQUIRED"
        assert error["details"]["reason"] == "trial_quota_exhausted"
        assert error["details"]["plan"] == "trial"
        assert error["details"]["used"] == 3
        assert error["details"]["limit"] == 3
        assert "premium" in error["message"].lower()

        receipt = client.post("/api/v1/payment", headers=dealer, json=CARD)
        assert receipt.status_code == 200, receipt.text
        assert receipt.json()["amount"] == "500.00"
        assert receipt.json()["plan"] == "dealer_premium"
        assert "4111111111111111" not in receipt.text

        assert create_quote(client, dealer, extra_request).status_code == 201
        subscription = client.get("/api/v1/profiles/me", headers=dealer).json()["subscription"]
        assert subscription["plan"] == "premium"
        assert subscription["quote_limit"] is None
        assert subscription["can_quote"] is True


def test_expired_trial_and_expired_premium_block_new_quotes() -> None:
    now = datetime.now(UTC)
    _, buyer_email = create_account("buyer")
    _, expired_trial_email = create_account("dealer", trial_expires_at=now - timedelta(days=10))
    _, expired_premium_email = create_account(
        "dealer", trial_expires_at=now - timedelta(days=30), premium_expires_at=now - timedelta(days=5)
    )
    with TestClient(app) as client:
        request_id = create_request(client, login(client, buyer_email))

        trial_dealer = login(client, expired_trial_email)
        assert client.get("/api/v1/auth/me", headers=trial_dealer).json()["subscription"]["plan"] == "free"
        blocked = create_quote(client, trial_dealer, request_id)
        assert blocked.status_code == 402, blocked.text
        assert blocked.json()["error"]["details"]["reason"] == "trial_expired"

        premium_dealer = login(client, expired_premium_email)
        assert client.get("/api/v1/auth/me", headers=premium_dealer).json()["subscription"]["plan"] == "free"
        premium_block = create_quote(client, premium_dealer, request_id)
        assert premium_block.status_code == 402, premium_block.text
        assert premium_block.json()["error"]["details"]["reason"] == "premium_expired"


def test_buyer_free_posts_block_then_payment_unlocks_and_receipt_is_tokenized() -> None:
    _, buyer_email = create_account("buyer")
    with TestClient(app) as client:
        buyer = login(client, buyer_email)
        for _ in range(3):
            assert client.post("/api/v1/requests", headers=buyer, json=request_payload()).status_code == 201

        blocked = client.post("/api/v1/requests", headers=buyer, json=request_payload())
        assert blocked.status_code == 402, blocked.text
        details = blocked.json()["error"]["details"]
        assert blocked.json()["error"]["code"] == "SUBSCRIPTION_REQUIRED"
        assert details["reason"] == "request_limit_reached"
        assert details["used"] == 3 and details["limit"] == 3

        response = client.post("/api/v1/payment", headers=buyer, json=CARD)
        assert response.status_code == 200, response.text
        receipt = response.json()
        assert receipt["amount"] == "100.00"
        assert receipt["plan"] == "buyer_premium"
        assert receipt["card_brand"] == "visa"
        assert receipt["card_last4"] == "1111"
        assert "card_number" not in receipt and "cvv" not in receipt
        assert "4111111111111111" not in response.text
        assert receipt["subscription"]["can_create_request"] is True
        assert client.post("/api/v1/requests", headers=buyer, json=request_payload()).status_code == 201

        profile_id = client.get("/api/v1/auth/me", headers=buyer).json()["id"]
        rows = fetch_payments(profile_id)
        assert len(rows) == 1
        assert rows[0].status == "succeeded"
        assert rows[0].card_brand == "visa" and rows[0].card_last4 == "1111"
        assert float(rows[0].amount) == 100.0
        assert "card_number" not in Payment.__table__.columns.keys()
        assert "cvv" not in Payment.__table__.columns.keys()


def test_payment_pricing_stacking_and_staff_are_forbidden() -> None:
    now = datetime.now(UTC)
    _, dealer_email = create_account("dealer", premium_expires_at=now + timedelta(days=100))
    _, support_email = create_account("support")
    with TestClient(app) as client:
        dealer = login(client, dealer_email)
        support = login(client, support_email)

        denied = client.post("/api/v1/payment", headers=support, json=CARD)
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "FORBIDDEN_ROLE"

        invalid = client.post("/api/v1/payment", headers=dealer, json={**CARD, "card_number": "12"})
        assert invalid.status_code == 422

        response = client.post("/api/v1/payment", headers=dealer, json=CARD)
        assert response.status_code == 200, response.text
        receipt = response.json()
        assert receipt["amount"] == "500.00"
        assert receipt["plan"] == "dealer_premium"
        expected_expiry = now + timedelta(days=100) + timedelta(days=365)
        stacked_expiry = datetime.fromisoformat(receipt["premium_expires_at"])
        assert abs((stacked_expiry - expected_expiry).total_seconds()) < 300


def test_sera_request_preview_reports_posting_gate() -> None:
    _, buyer_email = create_account("buyer")
    with TestClient(app) as client:
        buyer = login(client, buyer_email)
        payload = {"message": "Build my car request", "agent": "sera-agent", "quote_ids": []}

        preview = client.post("/api/v1/ai/request-preview", headers=buyer, json=payload)
        assert preview.status_code == 200, preview.text
        assert preview.json()["posting_allowed"] is True
        assert preview.json()["requests_used"] == 0
        assert preview.json()["request_limit"] == 3

        for _ in range(3):
            create_request(client, buyer, publish=False)

        gated = client.post("/api/v1/ai/request-preview", headers=buyer, json=payload)
        assert gated.status_code == 200, gated.text
        body = gated.json()
        assert body["posting_allowed"] is False
        assert body["posting_reason"] == "request_limit_reached"
        assert body["requests_used"] == 3
        assert body["request_limit"] == 3


def test_subscription_block_on_me_endpoints_and_staff_excluded() -> None:
    now = datetime.now(UTC)
    _, free_email = create_account("buyer")
    _, premium_email = create_account("buyer", premium_expires_at=now + timedelta(days=365))
    _, staff_email = create_account("support")
    with TestClient(app) as client:
        free = client.get("/api/v1/profiles/me", headers=login(client, free_email)).json()["subscription"]
        assert free["plan"] == "free"
        assert free["premium_price"] == "100.00"
        assert free["request_limit"] == 3
        assert free["requests_used"] == 0 and free["requests_remaining"] == 3
        assert free["can_create_request"] is True
        assert free["ai_posting_allowed"] is True

        premium = client.get("/api/v1/profiles/me", headers=login(client, premium_email)).json()["subscription"]
        assert premium["plan"] == "premium"
        assert premium["is_premium"] is True
        assert premium["request_limit"] is None
        assert premium["requests_remaining"] is None
        assert premium["can_create_request"] is True

        staff = login(client, staff_email)
        assert "subscription" not in client.get("/api/v1/auth/me", headers=staff).json()
