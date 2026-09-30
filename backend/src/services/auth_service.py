from datetime import UTC, datetime
from time import time
from uuid import uuid4

import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.security import create_token, decode_token, hash_password, token_hash, verify_password
from src.models.auth import BuyerSignup, DealerSignup, LoginRequest, SessionProfile, SupportSignup, TokenResponse
from src.repositories.auth_repository import AuthRepository
from src.repositories.schema import Profile, SupportVerification, User
from src.settings import DEFAULT_TERMS_VERSION, get_settings
from src.utils.exceptions import AppError, error_codes


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repository = AuthRepository(session)

    async def signup_buyer(self, payload: BuyerSignup) -> TokenResponse:
        profile = await self._create_profile(payload, "buyer", is_active=True)
        response = self._tokens(profile, True)
        profile.user.refresh_token_hash = token_hash(response.refresh_token)
        await self.repository.commit()
        return response

    async def signup_dealer(self, payload: DealerSignup) -> dict:
        profile = await self._create_profile(
            payload,
            "dealer",
            is_active=False,
            dealership_name=payload.dealership_name,
            branch_name=payload.branch_name,
            dealer_license=payload.dealer_license,
            website=str(payload.website),
            supported_brands=payload.supported_brand_ids,
        )
        verification = SupportVerification(ticket_id=f"DV{int(time())}", category="dealer", profile_id=profile.id, status="pending", notes=[])
        self.session.add(verification)
        await self.repository.commit()
        return {"status": "pending", "verification_id": verification.ticket_id, "email": profile.email}

    async def signup_support(self, payload: SupportSignup) -> dict:
        profile = await self._create_profile(payload, "support", is_active=False)
        verification = SupportVerification(
            ticket_id=f"SA{str(int(time()))[-6:]}", category="agent", profile_id=profile.id, status="pending",
            notes=[{"at": datetime.now(UTC).isoformat(), "note": payload.extra_information or "Application submitted"}],
        )
        self.session.add(verification)
        await self.repository.commit()
        return {"status": "pending", "verification_id": verification.ticket_id, "email": profile.email}

    async def login(self, payload: LoginRequest) -> TokenResponse:
        profile = await self.repository.profile_by_email(str(payload.email))
        if profile is None or not verify_password(payload.password, profile.user.password_hash):
            raise AppError(error_codes.INVALID_CREDENTIALS, "The email or password is incorrect.", 401)
        if not profile.user.is_active:
            code = error_codes.DEALER_PENDING_REVIEW if profile.role == "dealer" else error_codes.UNAUTHENTICATED
            raise AppError(code, f"Your {profile.role} account is awaiting approval.", 403)
        profile.user.last_login_at = datetime.now(UTC)
        response = self._tokens(profile, True)
        profile.user.refresh_token_hash = token_hash(response.refresh_token)
        await self.repository.commit()
        return response

    async def refresh(self, refresh_token: str) -> TokenResponse:
        try:
            payload = decode_token(refresh_token, "refresh")
        except jwt.InvalidTokenError as exc:
            raise AppError(error_codes.UNAUTHENTICATED, "The refresh token is invalid or expired.", 401) from exc
        profile = await self.repository.profile_with_user(payload["sub"])
        if profile is None or not profile.user.is_active or profile.user.refresh_token_hash != token_hash(refresh_token):
            raise AppError(error_codes.UNAUTHENTICATED, "The refresh token is no longer valid.", 401)
        if payload.get("role") != profile.role:
            profile.user.refresh_token_hash = None
            await self.repository.commit()
            raise AppError(error_codes.UNAUTHENTICATED, "Your access changed. Sign in again to refresh your permissions.", 401)
        response = self._tokens(profile, True)
        profile.user.refresh_token_hash = token_hash(response.refresh_token)
        await self.repository.commit()
        return response

    async def logout(self, profile: Profile) -> None:
        current = await self.repository.profile_with_user(profile.id)
        if current:
            current.user.refresh_token_hash = None
            await self.repository.commit()

    async def _create_profile(self, payload, role: str, is_active: bool, **extra) -> Profile:
        if await self.repository.profile_by_email(str(payload.email)):
            raise AppError(error_codes.CONFLICT, "An account already exists for this email.", 409)
        accepted_at = datetime.now(UTC)
        profile = Profile(
            id=str(uuid4()),
            state_id=payload.state_id, full_name=payload.full_name, email=str(payload.email).lower(), role=role,
            phone=payload.phone, address=payload.address, terms_accepted=payload.terms_accepted,
            terms_version=payload.terms_version or DEFAULT_TERMS_VERSION, terms_accepted_at=accepted_at, **extra,
        )
        user = User(profile=profile, password_hash=hash_password(payload.password), is_active=is_active)
        await self.repository.add_profile(profile, user)
        return profile

    def _tokens(self, profile: Profile, is_active: bool) -> TokenResponse:
        settings = get_settings()
        return TokenResponse(
            access_token=create_token(profile.id, profile.role, "access"),
            refresh_token=create_token(profile.id, profile.role, "refresh"),
            expires_in=settings.access_token_minutes * 60,
            profile=SessionProfile(id=profile.id, full_name=profile.full_name, email=profile.email, phone=profile.phone, role=profile.role, is_active=is_active),
        )
