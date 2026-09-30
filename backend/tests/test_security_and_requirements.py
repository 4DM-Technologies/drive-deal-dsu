import jwt
import pytest

from src.agents.requirements import gather_requirements
from src.auth.security import create_token, decode_token, hash_password, token_hash, verify_password


def test_password_and_tokens() -> None:
    encoded = hash_password("correct-horse-battery-staple")
    assert verify_password("correct-horse-battery-staple", encoded)
    assert not verify_password("wrong-password", encoded)
    token = create_token("profile-1", "buyer", "access")
    assert decode_token(token)["sub"] == "profile-1"
    assert token_hash(token) == token_hash(token)
    with pytest.raises(jwt.InvalidTokenError):
        decode_token(create_token("profile-1", "buyer", "refresh"))


def test_requirement_agent_extracts_safe_fields() -> None:
    result = gather_requirements({"message": "Ford SUV under $55,000 within 2 weeks", "requirements": {}})
    assert result["requirements"]["brand"] == "Ford"
    assert result["requirements"]["budget_max"] == "55000"
    assert result["requirements"]["timeline"] == "Within 2 weeks"
    assert result["suggested_questions"]
