import hashlib
from datetime import UTC, datetime, timedelta
from typing import Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from src.settings import get_settings

password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_token(profile_id: str, role: str, token_type: Literal["access", "refresh"]) -> str:
    settings = get_settings()
    lifetime = (
        timedelta(minutes=settings.access_token_minutes)
        if token_type == "access"  # nosec B105
        else timedelta(days=settings.refresh_token_days)
    )
    now = datetime.now(UTC)
    return jwt.encode({"sub": profile_id, "role": role, "type": token_type, "iat": now, "exp": now + lifetime}, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str, expected_type: Literal["access", "refresh"] = "access") -> dict:
    settings = get_settings()
    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("Unexpected token type")
    return payload
