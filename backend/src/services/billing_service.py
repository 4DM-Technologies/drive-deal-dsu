from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from src.models.payment import PaymentCreate
from src.repositories.billing_repository import BillingRepository
from src.repositories.schema import Payment, Profile
from src.settings import (
    BUYER_FREE_REQUEST_LIMIT,
    DEALER_TRIAL_DAYS,
    DEALER_TRIAL_QUOTE_LIMIT,
    PAYMENT_PLAN_BY_ROLE,
    PREMIUM_CURRENCY,
    PREMIUM_DURATION_DAYS,
    PREMIUM_PRICE_BY_ROLE,
)
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow

BLOCK_MESSAGES = {
    "trial_quota_exhausted": (
        f"Your free trial includes {DEALER_TRIAL_QUOTE_LIMIT} quotes. Subscribe to the premium plan to keep quoting."
    ),
    "trial_expired": "Your free trial has ended. Subscribe to the premium plan to keep quoting.",
    "premium_expired": "Your premium subscription has expired. Renew the premium plan to continue.",
    "request_limit_reached": (
        f"Your free plan includes {BUYER_FREE_REQUEST_LIMIT} car buy posts. "
        "Subscribe to the premium plan to publish more."
    ),
}


def as_utc(value: datetime | None) -> datetime | None:
    """Return an aware UTC datetime.

    PostgreSQL returns aware datetimes for ``DateTime(timezone=True)`` columns but SQLite
    drops the offset on read, so every comparison against ``datetime.now(UTC)`` normalizes
    through this helper to stay correct on both backends.
    """
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def detect_card_brand(card_number: str) -> str:
    digits = "".join(ch for ch in card_number if ch.isdigit())
    if digits.startswith("4"):
        return "visa"
    if digits[:2] in {"51", "52", "53", "54", "55"} or digits[:4] in {"2221", "2720"}:
        return "mastercard"
    if digits[:2] in {"34", "37"}:
        return "amex"
    if digits[:4] in {"6011"} or digits[:2] == "65":
        return "discover"
    return "card"


class BillingService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repository = BillingRepository(session)

    @staticmethod
    @log_flow(layer="service")
    def premium_active(profile: Profile, now: datetime | None = None) -> bool:
        now = now or datetime.now(UTC)
        expires = as_utc(profile.premium_expires_at)
        return bool(profile.is_premium and expires and expires > now)

    @staticmethod
    @log_flow(layer="service")
    def trial_active(profile: Profile, now: datetime | None = None) -> bool:
        now = now or datetime.now(UTC)
        expires = as_utc(profile.trial_expires_at)
        return bool(profile.role == "dealer" and profile.trial_started_at and expires and expires > now)

    @log_flow(layer="service")
    def ensure_dealer_trial(self, profile: Profile) -> None:
        """Stamp the two-month dealer trial on the first successful login."""
        if profile.role != "dealer" or profile.trial_started_at is not None:
            return
        now = datetime.now(UTC)
        profile.trial_started_at = now
        profile.trial_expires_at = now + timedelta(days=DEALER_TRIAL_DAYS)
        profile.updated_by = profile.id

    @log_flow(layer="service")
    async def subscription_state(self, profile: Profile) -> dict | None:
        """Derived subscription state for the billing screens.

        Returns None for staff roles that are not subject to marketplace limits.
        """
        if getattr(profile, "role", None) not in {"buyer", "dealer"}:
            return None
        now = datetime.now(UTC)
        premium = self.premium_active(profile, now)
        state: dict = {
            "role": profile.role,
            "plan": "premium" if premium else ("trial" if self.trial_active(profile, now) else "free"),
            "is_premium": premium,
            "premium_expires_at": as_utc(profile.premium_expires_at).isoformat()
            if profile.premium_expires_at
            else None,
            "trial_started_at": profile.trial_started_at.isoformat() if profile.trial_started_at else None,
            "trial_expires_at": as_utc(profile.trial_expires_at).isoformat() if profile.trial_expires_at else None,
            "premium_price": f"{PREMIUM_PRICE_BY_ROLE[profile.role]:.2f}",
            "currency": PREMIUM_CURRENCY,
        }
        if profile.role == "dealer":
            used = await self.repository.quote_count(profile.id)
            limit = DEALER_TRIAL_QUOTE_LIMIT if (premium or self.trial_active(profile, now)) else 0
            state.update(
                {
                    "quote_limit": None if premium else limit,
                    "quotes_used": used,
                    "quotes_remaining": None if premium else max(limit - used, 0),
                    "can_quote": premium or (self.trial_active(profile, now) and used < DEALER_TRIAL_QUOTE_LIMIT),
                }
            )
        else:
            used = await self.repository.request_count(profile.id)
            state.update(
                {
                    "request_limit": None if premium else BUYER_FREE_REQUEST_LIMIT,
                    "requests_used": used,
                    "requests_remaining": None if premium else max(BUYER_FREE_REQUEST_LIMIT - used, 0),
                    "can_create_request": premium or used < BUYER_FREE_REQUEST_LIMIT,
                    "ai_posting_allowed": premium or used < BUYER_FREE_REQUEST_LIMIT,
                }
            )
        return state

    @log_flow(layer="service")
    async def assert_can_quote(self, dealer: Profile) -> None:
        if self.premium_active(dealer):
            return
        used = await self.repository.quote_count(dealer.id)
        if used >= DEALER_TRIAL_QUOTE_LIMIT:
            reason = (
                "trial_quota_exhausted"
                if self.trial_active(dealer)
                else ("premium_expired" if dealer.is_premium else "trial_expired")
            )
            raise AppError(
                error_codes.SUBSCRIPTION_REQUIRED,
                BLOCK_MESSAGES[reason],
                402,
                details={
                    "reason": reason,
                    "plan": "trial" if self.trial_active(dealer) else "free",
                    "used": used,
                    "limit": DEALER_TRIAL_QUOTE_LIMIT,
                },
            )
        if not self.trial_active(dealer):
            reason = "premium_expired" if dealer.is_premium else "trial_expired"
            raise AppError(
                error_codes.SUBSCRIPTION_REQUIRED,
                BLOCK_MESSAGES[reason],
                402,
                details={
                    "reason": reason,
                    "plan": "free",
                    "used": used,
                    "limit": DEALER_TRIAL_QUOTE_LIMIT,
                },
            )

    @log_flow(layer="service")
    async def assert_can_create_request(self, buyer: Profile) -> None:
        if self.premium_active(buyer):
            return
        used = await self.repository.request_count(buyer.id)
        if used < BUYER_FREE_REQUEST_LIMIT:
            return
        reason = "premium_expired" if buyer.is_premium else "request_limit_reached"
        raise AppError(
            error_codes.SUBSCRIPTION_REQUIRED,
            BLOCK_MESSAGES[reason],
            402,
            details={
                "reason": reason,
                "plan": "free",
                "used": used,
                "limit": BUYER_FREE_REQUEST_LIMIT,
            },
        )

    @log_flow(layer="service")
    async def process_payment(self, profile: Profile, payload: PaymentCreate) -> dict:
        """Simulated payment: any well-formed card details succeed and unlock premium for one year."""
        if profile.role not in {"buyer", "dealer"}:
            raise AppError(error_codes.FORBIDDEN_ROLE, "Only buyers and dealers can subscribe.", 403)
        now = datetime.now(UTC)
        base = now
        if self.premium_active(profile, now):
            base = as_utc(profile.premium_expires_at) or now
        new_expiry = base + timedelta(days=PREMIUM_DURATION_DAYS)
        digits = "".join(ch for ch in payload.card_number if ch.isdigit())
        payment = Payment(
            id=str(uuid4()),
            profile_id=profile.id,
            plan=PAYMENT_PLAN_BY_ROLE[profile.role],
            amount=PREMIUM_PRICE_BY_ROLE[profile.role],
            currency=PREMIUM_CURRENCY,
            payment_method=payload.payment_method,
            card_brand=detect_card_brand(digits),
            card_last4=digits[-4:],
            status="succeeded",
            premium_expires_at=new_expiry,
            created_by=profile.id,
            updated_by=profile.id,
        )
        self.repository.add_payment(payment)
        profile.is_premium = True
        profile.premium_expires_at = new_expiry
        profile.updated_by = profile.id
        await self.repository.commit()
        await self.session.refresh(profile)
        state = await self.subscription_state(profile)
        return {
            "payment_id": payment.id,
            "status": payment.status,
            "plan": payment.plan,
            "amount": f"{payment.amount:.2f}",
            "currency": payment.currency,
            "payment_method": payment.payment_method,
            "card_brand": payment.card_brand,
            "card_last4": payment.card_last4,
            "premium_expires_at": new_expiry.isoformat(),
            "subscription": state,
        }
