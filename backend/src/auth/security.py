import hashlib
import hmac
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
    return jwt.encode(
        {"sub": profile_id, "role": role, "type": token_type, "iat": now, "exp": now + lifetime},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def decode_token(token: str, expected_type: Literal["access", "refresh"] = "access") -> dict:
    settings = get_settings()
    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("Unexpected token type")
    return payload


RESET_CODE_MINUTES = 30


def _reset_signature(user_id: str, password_hash: str, expires: int) -> str:
    message = f"password-reset\n{user_id}\n{password_hash}\n{expires}".encode()
    return hmac.new(get_settings().jwt_secret_key.encode(), message, hashlib.sha256).hexdigest()[:40]


def issue_reset_code(user) -> str:
    """A one-time password reset code: "<expiry>-<signature>".

    Nothing is stored. The signature covers the user and their current password hash, so the code stops working
    after RESET_CODE_MINUTES or as soon as the password changes, which makes it single-use.
    """
    expires = int((datetime.now(UTC) + timedelta(minutes=RESET_CODE_MINUTES)).timestamp())
    return f"{expires}-{_reset_signature(user.id, user.password_hash, expires)}"


def reset_code_is_valid(user, code: str) -> bool:
    expires_text, _, signature = code.strip().partition("-")
    if not expires_text.isdigit() or not signature:
        return False
    expires = int(expires_text)
    if expires < int(datetime.now(UTC).timestamp()):
        return False
    return hmac.compare_digest(_reset_signature(user.id, user.password_hash, expires), signature)
