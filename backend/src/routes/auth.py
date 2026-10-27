from fastapi import APIRouter, Depends, File, Form, Response, UploadFile, status
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, EmailStr, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.security import hash_password, issue_reset_code, reset_code_is_valid
from src.database import get_session
from src.middleware.auth import get_current_profile
from src.models.auth import BuyerSignup, DealerSignup, LoginRequest, RefreshRequest, SupportSignup, TokenResponse
from src.repositories.schema import Profile, User
from src.services.auth_service import AuthService
from src.services.billing_service import BillingService
from src.services.dealer_license import read_dealer_license
from src.services.driving_license import read_driving_license
from src.settings import get_settings
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


@log_flow(layer="route")
async def buyer_signup_form(
    first_name: str = Form(),
    last_name: str = Form(),
    email: str = Form(),
    phone: str = Form(),
    password: str = Form(),
    state_id: str = Form(),
    terms_accepted: bool = Form(),
    terms_version: str = Form(),
    address: str | None = Form(None),
) -> BuyerSignup:
    """Reads the buyer signup fields from the multipart form and applies the same rules as the JSON models."""
    try:
        return BuyerSignup(
            first_name=first_name,
            last_name=last_name,
            email=email,
            phone=phone,
            password=password,
            state_id=state_id,
            address=address or None,
            terms_accepted=terms_accepted,
            terms_version=terms_version,
        )
    except ValidationError as exc:
        raise _form_validation_error(exc) from exc


@router.post("/signup/buyer", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@log_flow(layer="route")
async def signup_buyer(
    payload: BuyerSignup = Depends(buyer_signup_form),
    driving_license: UploadFile | None = File(None),
    session: AsyncSession = Depends(get_session),
):
    """Creates a buyer from a multipart form: the signup fields, plus an optional ``driving_license`` photo or PDF.

    The signup screen no longer asks for a licence. One that is sent is still checked and stored privately, so the
    field can come back on screen without any change here.
    """
    upload = (
        None if driving_license is None or not driving_license.filename else await read_driving_license(driving_license)
    )
    return await AuthService(session).signup_buyer(payload, upload)


def _form_validation_error(exc: ValidationError) -> RequestValidationError:
    """Reports model errors against the form body, the same shape FastAPI uses for JSON bodies."""
    errors = exc.errors(include_url=False, include_context=False, include_input=False)
    return RequestValidationError([{**error, "loc": ("body", *error["loc"])} for error in errors])


@log_flow(layer="route")
async def dealer_signup_form(
    full_name: str = Form(),
    email: str = Form(),
    phone: str = Form(),
    password: str = Form(),
    state_id: str = Form(),
    terms_accepted: bool = Form(),
    terms_version: str = Form(),
    dealership_name: str = Form(),
    branch_name: str = Form(),
    dealer_license: str = Form(),
    supported_brand_ids: list[str] = Form(default_factory=list),
    other_brands: list[str] = Form(default_factory=list),
    address: str | None = Form(None),
    website: str | None = Form(None),
) -> DealerSignup:
    """Reads the dealer application fields from the multipart form and applies the same rules as the JSON model."""
    try:
        return DealerSignup(
            full_name=full_name,
            email=email,
            phone=phone,
            password=password,
            state_id=state_id,
            address=address or None,
            terms_accepted=terms_accepted,
            terms_version=terms_version,
            dealership_name=dealership_name,
            branch_name=branch_name,
            dealer_license=dealer_license,
            website=website,
            supported_brand_ids=supported_brand_ids,
            other_brands=other_brands,
        )
    except ValidationError as exc:
        raise _form_validation_error(exc) from exc


@router.post("/signup/dealer", status_code=status.HTTP_202_ACCEPTED)
@log_flow(layer="route")
async def signup_dealer(
    payload: DealerSignup = Depends(dealer_signup_form),
    motor_vehicle_dealer_license: UploadFile | None = File(None),
    session: AsyncSession = Depends(get_session),
):
    """Submits a dealer application from a multipart form: the fields plus a ``motor_vehicle_dealer_license`` PDF."""
    upload = await read_dealer_license(motor_vehicle_dealer_license)
    return await AuthService(session).signup_dealer(payload, upload)


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


async def _user_by_email(session: AsyncSession, email: str) -> User | None:
    return (
        await session.execute(select(User).join(Profile).where(Profile.email == email.lower()))
    ).scalar_one_or_none()


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
@log_flow(layer="route")
async def forgot_password(payload: ForgotPasswordRequest, session: AsyncSession = Depends(get_session)) -> dict:
    user = await _user_by_email(session, payload.email)
    if user is not None:
        code = issue_reset_code(user)
        # No mail sender exists yet. The same reply is returned whether or not the account exists, so this endpoint
        # cannot be used to discover accounts.
        if get_settings().password_reset_log_codes:
            logger.warning("password_reset_code_issued_for_local_testing", profile_id=user.profile_id, code=code)
        else:
            logger.info("password_reset_code_issued", profile_id=user.profile_id)
    return {"accepted": True, "message": "If the account exists, reset instructions will be sent."}


@router.post("/reset-password")
@log_flow(layer="route")
async def reset_password(payload: ResetPasswordRequest, session: AsyncSession = Depends(get_session)) -> dict:
    # Before this, the fixed code "DEMO-RESET" reset any account's password.
    user = await _user_by_email(session, payload.email)
    if user is None or not reset_code_is_valid(user, payload.reset_code):
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
