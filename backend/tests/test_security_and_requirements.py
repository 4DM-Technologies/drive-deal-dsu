from unittest.mock import AsyncMock, patch

import jwt
import pytest

from src.agents.requirements import (
    _extract_deterministic,
    _normalize_budget,
    gather_requirements,
    gather_requirements_from_message,
)
from src.auth.security import create_token, decode_token, hash_password, token_hash, verify_password

STATES = [
    {"name": "Texas", "code": "TX"},
    {"name": "Indiana", "code": "IN"},
    {"name": "Oregon", "code": "OR"},
    {"name": "Maine", "code": "ME"},
    {"name": "Oklahoma", "code": "OK"},
]


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


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("$45k", "45000"), ("45,000", "45000"), ("~40000", "40000"), ("$1.2M", "1200000"), ("abc", None)],
)
def test_budget_is_normalised_to_plain_digits(raw: str, expected: str | None) -> None:
    assert _normalize_budget(raw) == expected


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        # State codes must not fire on the ordinary words "in", "or", "me", "ok".
        ("I want a car in the city", None),
        ("me too, or maybe not", None),
        ("that is ok thanks", None),
        ("I live in Texas", "Texas"),
        ("ship it to Austin, TX", "Texas"),
    ],
)
def test_state_extraction_ignores_ordinary_words(message: str, expected: str | None) -> None:
    assert _extract_deterministic(message, {}, ["Ford"], STATES).get("state") == expected


class _FakeLlmResult:
    def __init__(self, text: str) -> None:
        self.text = text


async def _run(message: str, llm_text: str) -> tuple[dict, str]:
    async def reference_data(_session):
        return ["Ford", "Toyota", "Honda"], STATES

    with (
        patch("src.agents.requirements._reference_data", new=reference_data),
        patch("src.agents.llm.LlmClient.generate", new=AsyncMock(return_value=_FakeLlmResult(llm_text))) as generate,
    ):
        result = await gather_requirements_from_message(
            AsyncMock(), {"message": message, "requirements": {}, "thread_id": "t1"}
        )
    return result, generate.await_args.args[1]


async def test_llm_pass_resolves_a_city_to_its_state() -> None:
    """Regex cannot turn "Austin" into "Texas"; the model can, and the prompt constrains it to real states."""
    result, task = await _run(
        "I am looking in Austin, TX for a Bronco",
        '{"model_name":"Bronco","body_type":"SUV","buyer_area":"Austin, TX","state":"Texas","timeline":null,"budget_max":null}',
    )
    assert result["requirements"]["model"] == "Bronco"
    assert result["requirements"]["buyer_area"] == "Austin, TX"
    assert result["requirements"]["state"] == "Texas"
    assert task == "requirement_extraction"


async def test_llm_pass_never_overwrites_deterministic_values() -> None:
    result, _ = await _run(
        "Ford Bronco in Austin TX under 55000 within 2 weeks",
        '{"model_name":"Mustang","body_type":"Coupe","buyer_area":null,"state":null,"timeline":null,"budget_max":"10"}',
    )
    assert result["requirements"]["brand"] == "Ford"
    assert result["requirements"]["budget_max"] == "55000"
    assert result["requirements"]["timeline"] == "Within 2 weeks"
    # Only the still-missing field is taken from the model.
    assert result["requirements"]["model"] == "Mustang"


async def test_llm_pass_rejects_a_state_that_is_not_a_real_state() -> None:
    result, _ = await _run(
        "hello",
        '{"model_name":null,"body_type":null,"buyer_area":null,"state":"Texus","timeline":null,"budget_max":null}',
    )
    assert "state" not in result["requirements"]


async def test_requirement_extraction_falls_back_when_the_model_fails() -> None:
    """The requirements card is advisory, so a bad model reply must never fail the turn."""
    with (
        patch("src.agents.requirements._reference_data", new=AsyncMock(return_value=(["Ford"], STATES))),
        patch("src.agents.llm.LlmClient.generate", new=AsyncMock(side_effect=RuntimeError("provider down"))),
    ):
        result = await gather_requirements_from_message(
            AsyncMock(), {"message": "Ford under 40000", "requirements": {}, "thread_id": "t1"}
        )
    assert result["requirements"]["brand"] == "Ford"
    assert result["requirements"]["budget_max"] == "40000"
    assert result["missing_fields"]
