import asyncio
from datetime import UTC, datetime
from time import time
from uuid import uuid4

import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.security import create_token, decode_token, hash_password, token_hash, verify_password
from src.models.auth import BuyerSignup, DealerSignup, LoginRequest, SessionProfile, SupportSignup, TokenResponse
from src.repositories.auth_repository import AuthRepository
from src.repositories.schema import BuyerDocument, Profile, SupportVerification, User
from src.services.billing_service import BillingService
from src.services.driving_license import DrivingLicenseUpload, driving_license_key
from src.services.storage import Storage, StorageError, StorageObject, get_storage
from src.settings import DEFAULT_TERMS_VERSION, DRIVING_LICENSE_DOCUMENT_TYPE, get_settings
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow
from src.utils.logger import logger


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repository = AuthRepository(session)

    @log_flow(layer="service")
    async def signup_buyer(self, payload: BuyerSignup, driving_license: DrivingLicenseUpload) -> TokenResponse:
        profile = await self._create_profile(payload, "buyer", is_active=True)
        storage = get_storage()
        stored_key = await self._store_driving_license(storage, profile, driving_license)
        try:
            response = self._tokens(profile, True)
            profile.user.refresh_token_hash = token_hash(response.refresh_token)
            await self.repository.commit()
        except Exception:
            # The account was not saved, so the licence must not be left behind in storage.
            await self._discard_stored_object(storage, stored_key)
            raise
        logger.info("buyer_signup", profile_id=profile.id, role="buyer", driving_license_key=stored_key)
        return response

    @log_flow(layer="service")
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
        verification = SupportVerification(
            ticket_id=f"DV{int(time())}", category="dealer", profile_id=profile.id, status="pending", notes=[]
        )
        self.session.add(verification)
        await self.repository.commit()
        logger.info("dealer_signup", profile_id=profile.id, role="dealer", verification_id=verification.ticket_id)
        return {"status": "pending", "verification_id": verification.ticket_id, "email": profile.email}

    @log_flow(layer="service")
    async def signup_support(self, payload: SupportSignup) -> dict:
        profile = await self._create_profile(payload, "support", is_active=False)
        verification = SupportVerification(
            ticket_id=f"SA{str(int(time()))[-6:]}",
            category="agent",
            profile_id=profile.id,
            status="pending",
            notes=[{"at": datetime.now(UTC).isoformat(), "note": payload.extra_information or "Application submitted"}],
        )
        self.session.add(verification)
        await self.repository.commit()
        logger.info("support_signup", profile_id=profile.id, role="support", verification_id=verification.ticket_id)
        return {"status": "pending", "verification_id": verification.ticket_id, "email": profile.email}

    @log_flow(layer="service")
    async def login(self, payload: LoginRequest) -> TokenResponse:
        profile = await self.repository.profile_by_email(str(payload.email))
        if profile is None or not verify_password(payload.password, profile.user.password_hash):
            raise AppError(error_codes.INVALID_CREDENTIALS, "The email or password is incorrect.", 401)
        if not profile.user.is_active:
            code = error_codes.DEALER_PENDING_REVIEW if profile.role == "dealer" else error_codes.UNAUTHENTICATED
            raise AppError(code, f"Your {profile.role} account is awaiting approval.", 403)
        profile.user.last_login_at = datetime.now(UTC)
        BillingService(self.session).ensure_dealer_trial(profile)
        response = self._tokens(profile, True)
        profile.user.refresh_token_hash = token_hash(response.refresh_token)
        await self.repository.commit()
        logger.info("login_success", profile_id=profile.id, role=profile.role)
        return response

    @log_flow(layer="service")
    async def refresh(self, refresh_token: str) -> TokenResponse:
        try:
            payload = decode_token(refresh_token, "refresh")
        except jwt.InvalidTokenError as exc:
            raise AppError(error_codes.UNAUTHENTICATED, "The refresh token is invalid or expired.", 401) from exc
        profile = await self.repository.profile_with_user(payload["sub"])
        if (
            profile is None
            or not profile.user.is_active
            or profile.user.refresh_token_hash != token_hash(refresh_token)
        ):
            raise AppError(error_codes.UNAUTHENTICATED, "The refresh token is no longer valid.", 401)
        if payload.get("role") != profile.role:
            profile.user.refresh_token_hash = None
            await self.repository.commit()
            raise AppError(
                error_codes.UNAUTHENTICATED, "Your access changed. Sign in again to refresh your permissions.", 401
            )
        response = self._tokens(profile, True)
        profile.user.refresh_token_hash = token_hash(response.refresh_token)
        await self.repository.commit()
        logger.info("token_refreshed", profile_id=profile.id, role=profile.role)
        return response

    @log_flow(layer="service")
    async def logout(self, profile: Profile) -> None:
        current = await self.repository.profile_with_user(profile.id)
        if current:
            current.user.refresh_token_hash = None
            await self.repository.commit()
            logger.info("logout", profile_id=profile.id, role=profile.role)

    @log_flow(layer="service")
    async def _create_profile(self, payload, role: str, is_active: bool, **extra) -> Profile:
        if await self.repository.profile_by_email(str(payload.email)):
            raise AppError(error_codes.CONFLICT, "An account already exists for this email.", 409)
        accepted_at = datetime.now(UTC)
        profile = Profile(
            id=str(uuid4()),
            state_id=payload.state_id,
            full_name=payload.full_name,
            email=str(payload.email).lower(),
            role=role,
            phone=payload.phone,
            address=payload.address,
            terms_accepted=payload.terms_accepted,
            terms_version=payload.terms_version or DEFAULT_TERMS_VERSION,
            terms_accepted_at=accepted_at,
            **extra,
        )
        user = User(profile=profile, password_hash=hash_password(payload.password), is_active=is_active)
        await self.repository.add_profile(profile, user)
        return profile

    @log_flow(layer="service")
    async def _store_driving_license(
        self, storage: Storage, profile: Profile, driving_license: DrivingLicenseUpload
    ) -> str:
        key = driving_license_key(profile.id, driving_license.extension)
        item = StorageObject(key=key, content=driving_license.content, content_type=driving_license.content_type)
        try:
            # boto3 is blocking, so the upload runs off the event loop.
            await asyncio.to_thread(storage.put_object, item)
        except StorageError as exc:
            logger.error("driving_license_upload_failed", profile_id=profile.id, error=str(exc))
            raise AppError(
                error_codes.STORAGE_UNAVAILABLE,
                "We could not store your driving licence right now. Please try again in a moment.",
                503,
            ) from exc
        self.session.add(
            BuyerDocument(
                profile_id=profile.id,
                document_type=DRIVING_LICENSE_DOCUMENT_TYPE,
                object_key=key,
                file_name=driving_license.file_name,
                content_type=driving_license.content_type,
                size_bytes=driving_license.size_bytes,
            )
        )
        return key

    @log_flow(layer="service")
    async def _discard_stored_object(self, storage: Storage, key: str) -> None:
        try:
            await asyncio.to_thread(storage.delete_object, key)
        except StorageError as exc:
            logger.warning("driving_license_cleanup_failed", object_key=key, error=str(exc))

    @log_flow(layer="service")
    def _tokens(self, profile: Profile, is_active: bool) -> TokenResponse:
        settings = get_settings()
        return TokenResponse(
            access_token=create_token(profile.id, profile.role, "access"),
            refresh_token=create_token(profile.id, profile.role, "refresh"),
            expires_in=settings.access_token_minutes * 60,
            profile=SessionProfile(
                id=profile.id,
                full_name=profile.full_name,
                email=profile.email,
                phone=profile.phone,
                role=profile.role,
                is_active=is_active,
            ),
        )
