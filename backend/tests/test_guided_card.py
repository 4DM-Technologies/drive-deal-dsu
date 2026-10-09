"""Guided question card: matcher, planner, the /ai/guided/next endpoint and the chat shortcut."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
from src.models.guided import GuidedAction, GuidedAnswers, GuidedNextRequest
from src.services.catalog.matcher import match_message
from src.services.catalog.planner import GuidedPlanner
from src.services.catalog.sync import sync_catalog
from tests.agents.test_catalog_tools import ROWS
from tests.demo_data import IDS
from tests.test_api import login
from tests.test_catalog_sync import clear_catalog, epa_row

CARD_ROWS = [
    *ROWS,
    epa_row(
        id="20",
        make="Jeep",
        model="Wrangler 4dr 4WD",
        baseModel="Wrangler",
        VClass="Special Purpose Vehicle 4WD",
        drive="4-Wheel Drive",
    ),
]


@pytest.fixture
async def catalog():
    from src.database import SessionFactory, dispose_engine

    await clear_catalog()
    async with SessionFactory() as session:
        await sync_catalog(session, iter(CARD_ROWS), [2024, 2025], run_validation=False)
        await session.commit()
    await clear_catalog_cache()
    yield SessionFactory
    await clear_catalog()
    await dispose_engine()


async def clear_catalog_cache() -> None:
    from src.services.catalog.matcher import invalidate_catalog_index

    invalidate_catalog_index()


async def start(session_factory, message: str):
    async with session_factory() as session:
        return await GuidedPlanner(session).from_match(await match_message(session, message))


async def step(session_factory, answers: GuidedAnswers, **action):
    async with session_factory() as session:
        return await GuidedPlanner(session).next(GuidedNextRequest(answers=answers, action=GuidedAction(**action)))


async def answer(session_factory, current, *, pick: int | None = None, text: str | None = None):
    question = current.question
    values = [question.options[pick].value] if pick is not None else []
    return await step(
        session_factory, current.answers, type="answer", question_id=question.id, values=values, text=text
    )


async def test_a_named_model_walks_to_a_complete_draft(catalog) -> None:
    current = await start(catalog, "I want a BMW M3")
    assert (current.question.id, current.question.index, current.question.total) == ("variant", 1, 5)
    assert len(current.question.options) == 3

    current = await answer(catalog, current, text="competition sedan")
    # The test catalog sells this version in 2025 only, so the year is filled in and not asked.
    assert current.question.id == "must_haves" and current.answers.model_year == 2025
    current = await answer(catalog, current, text="Austin, TX")  # a city typed early fills the location question
    assert current.question.id == "must_haves" and current.answers.state == "Texas"
    current = await step(catalog, current.answers, type="skip", question_id="must_haves")
    assert current.question.id == "timeline"
    current = await answer(catalog, current, text="asap")

    assert current.question is None
    draft = current.draft
    assert (draft["brand"], draft["model"], draft["trim"], draft["transmission"]) == (
        "BMW",
        "M3",
        "Competition",
        "Automatic",
    )
    assert (draft["state"], draft["timeline"], draft["brandId"]) == ("Texas", "ASAP", IDS["bmw"])
    assert "budgetMax" not in draft  # budget is never asked unless the buyer mentions money


async def test_location_requires_a_city_and_state_and_returns_a_clear_retry_message(catalog) -> None:
    current = await start(catalog, "I want a BMW M3")
    current = await answer(catalog, current, text="competition sedan")
    current = await step(catalog, current.answers, type="skip", question_id="must_haves")
    assert current.question.id == "area"

    state_only = await answer(catalog, current, text="New York")
    assert state_only.question.id == "area"
    assert state_only.message == "Please enter both a city and state, such as Los Angeles, CA."

    valid_location = await answer(catalog, current, text="Los Angeles, CA")
    assert valid_location.answers.buyer_area == "Los Angeles"
    assert valid_location.answers.state == "California"
    assert valid_location.question.id == "timeline"


async def test_a_brand_starts_with_body_styles_and_budget_is_only_added_when_money_comes_up(catalog) -> None:
    current = await start(catalog, "I want a BMW")
    assert current.question.id == "body_style"
    assert {option.value for option in current.question.options} == {"SUV", "Sedan"}
    total_before = current.question.total

    current = await answer(catalog, current, text="something affordable")
    assert current.question.id == "body_style" and current.question.total == total_before + 1
    current = await answer(catalog, current, pick=0)
    assert current.question.id == "budget"
    current = await answer(catalog, current, text="$45k")
    assert current.answers.budget_max == 45000


async def test_an_amount_in_the_opening_message_fills_the_budget_without_a_question(catalog) -> None:
    current = await start(catalog, "BMW M3 manual under 90k")
    assert current.answers.budget_max == 90000
    # "manual" left one version and the catalog has one year for it, so both are filled in automatically.
    assert current.question.id == "must_haves"
    assert current.question.index == 1 and current.question.total == 3


async def test_opening_request_keeps_exterior_color_and_transmission(catalog) -> None:
    current = await start(catalog, "I want a black BMW M3 with automatic transmission")

    assert current.answers.filters.transmission == "Automatic"
    assert current.answers.must_haves == ["Exterior color: Black"]


async def test_back_undoes_the_last_answer_and_questions_go_to_sera(catalog) -> None:
    current = await start(catalog, "I want a BMW M3")
    current = await answer(catalog, current, pick=0)
    assert current.question.id == "must_haves"
    current = await step(catalog, current.answers, type="back")
    assert current.question.id == "variant" and current.answers.variant_id is None

    unresolved = await answer(catalog, current, text="what is the difference between these?")
    assert unresolved.unresolved is True and unresolved.question.id == "variant"


async def test_unlinked_brands_and_ambiguous_messages(catalog) -> None:
    assert await start(catalog, "I want a Jeep Wrangler") is None
    both = await start(catalog, "BMW or Audi")
    assert both.question.id == "disambiguate"
    assert {option.label for option in both.question.options} == {"BMW", "Audi"}


async def test_tampered_answers_are_dropped(catalog) -> None:
    tampered = GuidedAnswers(entry="model", make_slug="jeep", model_slug="wrangler", variant_id="not-a-real-id")
    current = await step(catalog, tampered, type="resume")
    assert current.answers.make_slug is None and current.answers.variant_id is None


def test_the_endpoint_is_for_buyers_only(catalog) -> None:
    with TestClient(app) as client:
        body = {"answers": {"entry": "button"}, "action": {"type": "resume"}}
        buyer = client.post("/api/v1/ai/guided/next", json=body, headers=login(client, "rahul@drivedeal.demo"))
        assert buyer.status_code == 200, buyer.text
        assert buyer.json()["question"]["id"] == "make"
        anonymous = client.post("/api/v1/ai/guided/next", json=body)
        assert anonymous.status_code in (401, 403)


async def test_chat_opens_the_card_without_any_llm_call(catalog, monkeypatch) -> None:
    from src.models.marketplace import AiChatRequest
    from src.repositories.schema import Profile
    from src.services.ai_service import AiService
    from src.settings import get_settings

    monkeypatch.setattr(get_settings(), "ai_disabled", False)
    generate = AsyncMock()
    async with catalog() as session:
        buyer = await session.get(Profile, IDS["buyer"])
        with patch("src.agents.llm.LlmClient.generate", new=generate):
            events = [
                event async for event in AiService(session).stream_chat(AiChatRequest(message="I want a BMW M3"), buyer)
            ]

    generate.assert_not_called()
    cards = [event for event in events if event["type"] == "card"]
    assert [card["kind"] for card in cards] == ["question"]
    assert cards[0]["payload"]["question"]["id"] == "variant"
    assert "M3" in "".join(event["text"] for event in events if event["type"] == "token")
    assert events[-1]["type"] == "done"
