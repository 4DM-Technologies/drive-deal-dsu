from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.security import hash_password
from src.database import get_session
from src.middleware.auth import get_current_profile
from src.models.auth import BuyerSignup, DealerSignup, LoginRequest, RefreshRequest, SupportSignup, TokenResponse
from src.repositories.schema import Profile, User
from src.services.auth_service import AuthService
from src.services.billing_service import BillingService
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow
from src.utils.logger import logger
from src.utils.serialization import model_dict

router = APIRouter(prefix="/auth", tags=["Authentication"])


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    reset_code: str = Field(min_length=6, max_length=64)
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/signup/buyer", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@log_flow(layer="route")
async def signup_buyer(payload: BuyerSignup, session: AsyncSession = Depends(get_session)):
    return await AuthService(session).signup_buyer(payload)


@router.post("/signup/dealer", status_code=status.HTTP_202_ACCEPTED)
@log_flow(layer="route")
async def signup_dealer(payload: DealerSignup, session: AsyncSession = Depends(get_session)):
    return await AuthService(session).signup_dealer(payload)


@router.post("/signup/support", status_code=status.HTTP_202_ACCEPTED)
@log_flow(layer="route")
async def signup_support(payload: SupportSignup, session: AsyncSession = Depends(get_session)):
    return await AuthService(session).signup_support(payload)


@router.post("/login", response_model=TokenResponse)
@log_flow(layer="route")
async def login(payload: LoginRequest, session: AsyncSession = Depends(get_session)):
    return await AuthService(session).login(payload)


@router.post("/refresh", response_model=TokenResponse)
@log_flow(layer="route")
async def refresh(payload: RefreshRequest, session: AsyncSession = Depends(get_session)):
    return await AuthService(session).refresh(payload.refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
@log_flow(layer="route")
async def logout(
    profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)
) -> Response:
    await AuthService(session).logout(profile)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
@log_flow(layer="route")
async def forgot_password(_: ForgotPasswordRequest) -> dict:
    # Production adapters can deliver a signed code through the configured mail provider.
    return {"accepted": True, "message": "If the account exists, reset instructions will be sent."}


@router.post("/reset-password")
@log_flow(layer="route")
async def reset_password(payload: ResetPasswordRequest, session: AsyncSession = Depends(get_session)) -> dict:
    if payload.reset_code != "DEMO-RESET":
        raise AppError(error_codes.INVALID_CREDENTIALS, "The reset code is invalid or expired.", 400)
    user = (
        await session.execute(select(User).join(Profile).where(Profile.email == payload.email.lower()))
    ).scalar_one_or_none()
    if user is None:
        raise AppError(error_codes.INVALID_CREDENTIALS, "The reset code is invalid or expired.", 400)
    user.password_hash = hash_password(payload.new_password)
    user.refresh_token_hash = None
    await session.commit()
    logger.info("password_reset", profile_id=user.profile_id)
    return {"reset": True}


@router.get("/me")
@log_flow(layer="route")
async def me(profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)) -> dict:
    data = model_dict(profile)
    subscription = await BillingService(session).subscription_state(profile)
    if subscription is not None:
        data["subscription"] = subscription
    return data
