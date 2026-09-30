from collections.abc import Callable

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.security import decode_token
from src.database import get_session
from src.repositories.schema import Profile, User
from src.utils.exceptions import AppError, error_codes

bearer = HTTPBearer(auto_error=False)


async def get_current_profile(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> Profile:
    if credentials is None:
        raise AppError(error_codes.UNAUTHENTICATED, "Sign in to continue.", 401)
    try:
        payload = decode_token(credentials.credentials)
    except jwt.InvalidTokenError as exc:
        raise AppError(error_codes.UNAUTHENTICATED, "Your session is invalid or expired.", 401) from exc
    result = await session.execute(select(Profile).join(User).where(Profile.id == payload["sub"], User.is_active.is_(True)))
    profile = result.scalar_one_or_none()
    if profile is None:
        raise AppError(error_codes.UNAUTHENTICATED, "Your account is not active.", 401)
    if payload.get("role") != profile.role:
        raise AppError(error_codes.UNAUTHENTICATED, "Your access changed. Sign in again to refresh your permissions.", 401)
    return profile


def require_roles(*roles: str) -> Callable:
    async def dependency(profile: Profile = Depends(get_current_profile)) -> Profile:
        if profile.role not in roles:
            raise AppError(error_codes.FORBIDDEN_ROLE, "This action is not available to your role.", 403)
        return profile

    return dependency
