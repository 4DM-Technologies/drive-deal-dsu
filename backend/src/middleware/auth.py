from collections.abc import Callable
from typing import NoReturn

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.security import decode_token
from src.database import get_session
from src.repositories.schema import Profile, User
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow
from src.utils.logger import logger

bearer = HTTPBearer(auto_error=False)


def reject(reason: str, message: str) -> NoReturn:
    """Logs why access was denied then raises the standard 401, so every rejection is traceable."""
    logger.warning("auth_rejected", reason=reason)
    raise AppError(error_codes.UNAUTHENTICATED, message, 401)


@log_flow(layer="middleware")
async def get_current_profile(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> Profile:
    if credentials is None:
        reject("missing_credentials", "Sign in to continue.")
    try:
        payload = decode_token(credentials.credentials)
    except jwt.InvalidTokenError as exc:
        logger.warning("auth_rejected", reason="invalid_token")
        raise AppError(error_codes.UNAUTHENTICATED, "Your session is invalid or expired.", 401) from exc
    result = await session.execute(select(Profile).join(User).where(Profile.id == payload["sub"], User.is_active.is_(True)))
    profile = result.scalar_one_or_none()
    if profile is None:
        reject("account_inactive", "Your account is not active.")
    if payload.get("role") != profile.role:
        reject("role_changed", "Your access changed. Sign in again to refresh your permissions.")
    logger.info("auth_checked", profile_id=profile.id, role=profile.role)
    return profile


def require_roles(*roles: str) -> Callable:
    @log_flow(layer="middleware")
    async def dependency(profile: Profile = Depends(get_current_profile)) -> Profile:
        if profile.role not in roles:
            logger.warning("role_check_failed", profile_id=profile.id, role=profile.role, allowed=list(roles))
            raise AppError(error_codes.FORBIDDEN_ROLE, "This action is not available to your role.", 403)
        return profile

    return dependency
