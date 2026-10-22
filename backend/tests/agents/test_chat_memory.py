"""The chat's running memory: cars Sera suggested and what the buyer said, kept across the whole chat."""

from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import select

from src.agents.memory import (
    bootstrap_summary,
    resolve_earlier_reference,
    summary_text,
    update_summary,
    vehicle_names,
)
from src.agents.serra.graph import build_web_query, main_agent
from src.services.ai_service import AiService, _compact_conversation_context, _refine_chat_memory
from src.services.catalog.matcher import MatchResult
from src.settings import get_settings

BUYER_ID = "10000000-0000-4000-8000-000000000001"

TOP_FIVE = (
    "Here are five strong 2026 choices:\n\n1. **Honda Civic Hybrid** — Value.\n\n2. **Toyota Camry** — Dependable.\n\n"
    "3. **Hyundai Palisade Hybrid** — Family SUV.\n\n4. **Tesla Model 3** — Electric.\n\n5. **Ford Maverick** — Pickup."
)
DATE_CARS = (
    "1. **Ford Mustang EcoBoost Convertible** — Bold.\n2. **Toyota GR86** — Fun.\n3. **Hyundai IONIQ 5 N** — Fast."
)


@dataclass
class _FakeLlmResult:
    text: str
    status: str = "success"


def _hyundai_chat_summary() -> dict:
    """The real chat behind the bug: a Hyundai was suggested in turn 2, asked about nine turns later."""
    summary = update_summary(None, user_message="hiii", answer="Hi! What are you shopping for?", route="small_talk")
    summary = update_summary(summary, user_message="can you tell me top 5 good cars", answer=TOP_FIVE, route="advice")
    summary = update_summary(
        summary,
        user_message="compare porsche and tesla",
        answer="| **Porsche 911** vs. **Tesla Model S** |",
        route="compare",
    )
    summary = update_summary(
        summary, user_message="what is 2+2", answer="That's outside what I can help with.", route="off_topic"
    )
    summary = update_summary(summary, user_message="cars for dates", answer=DATE_CARS, route="advice")
    for message in ("too common", "tesla roadster", "tesla flying car"):
        summary = update_summary(summary, user_message=message, answer="Noted.", route="advice")
    return summary


def test_vehicle_names_come_from_bold_names_and_list_headings_in_order() -> None:
    assert vehicle_names(TOP_FIVE) == [
        "Honda Civic Hybrid",
        "Toyota Camry",
        "Hyundai Palisade Hybrid",
        "Tesla Model 3",
        "Ford Maverick",
    ]
    assert vehicle_names("## **Porsche 911 vs. Tesla Model S**") == ["Porsche 911", "Tesla Model S"]
    assert vehicle_names("| **2027 Nissan Kicks** | 31 mpg |") == ["Nissan Kicks"]


@pytest.mark.parametrize(
    "answer",
    [
        "- **Vehicle:** 2027 Nissan Kicks",  # a request-summary label, not a suggestion
        "**Choose the Kicks for everyday driving**",  # bold prose that does not start with a make
        "**Honda** makes reliable cars",  # a make alone
    ],
)
def test_labels_prose_and_bare_makes_are_not_cars(answer: str) -> None:
    assert vehicle_names(answer) == []


def test_summary_keeps_every_car_sera_suggested_with_its_turn() -> None:
    summary = _hyundai_chat_summary()
    cars = [(car["n"], car["name"], car["turn"]) for car in summary["cars_suggested"]]
    assert cars[:5] == [
        (1, "Honda Civic Hybrid", 2),
        (2, "Toyota Camry", 2),
        (3, "Hyundai Palisade Hybrid", 2),
        (4, "Tesla Model 3", 2),
        (5, "Ford Maverick", 2),
    ]
    assert ("Hyundai IONIQ 5 N", 5) in [(car["name"], car["turn"]) for car in summary["cars_suggested"]]
    assert summary["turn"] == 8


def test_small_talk_and_off_topic_replies_add_no_cars() -> None:
    summary = update_summary(None, user_message="hi", answer="**Toyota Camry** is great", route="small_talk")
    assert summary["cars_suggested"] == []


def test_buyer_details_come_from_messages_cards_and_requirements_and_the_latest_wins() -> None:
    summary = update_summary(None, user_message="my budget is around 25 grand", answer="", route="advice")
    summary = update_summary(
        summary,
        user_message="ok I want a used blue one with AWD",
        answer="",
        route="requirements",
        requirements={"brand": "Honda", "model": "CR-V", "buyer_area": "Austin", "state": "Texas"},
    )
    summary = update_summary(summary, user_message="actually not more than $28,000", answer="", route="advice")

    buyer = summary["buyer"]
    assert (buyer["budget_max"], buyer["color"], buyer["drivetrain"], buyer["condition"]) == (
        "28000",
        "Blue",
        "AWD",
        "Used",
    )
    assert buyer["location"] == "Austin, Texas"
    assert summary["chosen_car"] == "Honda CR-V"


def test_the_request_card_on_screen_and_a_published_request_are_remembered() -> None:
    summary = update_summary(
        None,
        user_message="send it",
        answer="",
        request_context={
            "brand": "Nissan",
            "model": "Kicks",
            "area": "Las Vegas",
            "timeline": "2 weeks",
            "budget": "30000",
        },
    )
    assert summary["chosen_car"] == "Nissan Kicks"
    assert summary["buyer"]["location"] == "Las Vegas"
    assert summary["request"] == {"status": "draft"}
    summary = update_summary(summary, user_message=None, answer=None, published_request_id="r1")
    assert summary["request"] == {"status": "published", "id": "r1"}


def test_a_long_chat_keeps_its_first_suggestions_when_the_list_is_capped() -> None:
    summary = None
    for index in range(30):
        answer = f"1. **Toyota Model{index}A** — x\n2. **Honda Model{index}B** — y"
        summary = update_summary(summary, user_message=f"q{index}", answer=answer, route="advice")
    names = [car["name"] for car in summary["cars_suggested"]]
    assert len(names) == 40
    assert names[0] == "Toyota Model0A"
    assert names[-1] == "Honda Model29B"


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("fine i want to compare the first car you suggested from hyundai brand", ["Hyundai Palisade Hybrid"]),
        ("the second car you suggested", ["Toyota Camry"]),
        ("the last Toyota you mentioned", ["Toyota GR86"]),
        ("show me the hyundai you suggested earlier", ["Hyundai Palisade Hybrid", "Hyundai IONIQ 5 N"]),
        ("compare the Kicks and Corvette", []),  # names its own cars; nothing to resolve
        ("the first car", []),  # no sign it means an earlier suggestion
    ],
)
def test_earlier_references_resolve_across_the_whole_chat(message: str, expected: list[str]) -> None:
    assert resolve_earlier_reference(message, _hyundai_chat_summary()) == expected


def test_summary_text_is_short_and_readable_for_a_prompt() -> None:
    summary = update_summary(_hyundai_chat_summary(), user_message="budget is 30k, blue please", answer="")
    text = summary_text(summary)
    assert "budget up to $30,000" in text and "color Blue" in text
    assert "#3 Hyundai Palisade Hybrid (turn 2)" in text
    assert len(text) < 2000
    assert summary_text(None) == ""


def test_chats_saved_before_memory_are_rebuilt_from_their_loaded_turns() -> None:
    summary = bootstrap_summary(
        [{"role": "user", "body": "top 5 good cars"}, {"role": "assistant", "body": TOP_FIVE}, {"request_context": {}}]
    )
    assert [car["name"] for car in summary["cars_suggested"]][2] == "Hyundai Palisade Hybrid"


def test_compaction_shrinks_old_answers_to_their_cars_instead_of_dropping_them() -> None:
    """Regression: the "top 5" answer (826 chars) was skipped while its question was kept, losing the Palisade."""
    context = [{"role": "user", "body": "can you tell me top 5 good cars"}, {"role": "assistant", "body": TOP_FIVE * 3}]
    for index in range(8):
        context += [{"role": "user", "body": f"question {index}"}, {"role": "assistant", "body": "x" * 900}]

    compacted = _compact_conversation_context(context, max_chars=6000)

    bodies = [item["body"] for item in compacted]
    assert any(
        body.startswith("Suggested: Honda Civic Hybrid, Toyota Camry, Hyundai Palisade Hybrid") for body in bodies
    )
    assert sum(len(str(item)) for item in compacted) <= 6000
    assert compacted[-1]["body"] == "x" * 900  # the latest exchange is kept


def test_compaction_never_keeps_a_question_without_its_answer() -> None:
    context = []
    for index in range(10):
        context += [{"role": "user", "body": f"q{index} " + "y" * 600}, {"role": "assistant", "body": "z" * 2100}]
    compacted = _compact_conversation_context(context, max_chars=6000)
    roles = [item["role"] for item in compacted]
    assert all(not (a == "user" and b == "user") for a, b in zip(roles, roles[1:], strict=False))


@pytest.fixture
def catalog():
    match = AsyncMock(return_value=MatchResult())
    with (
        patch("src.agents.serra.graph.match_message", new=match),
        patch("src.agents.serra.graph.run_catalog_tools", new=AsyncMock(return_value=[])),
    ):
        yield match


async def test_compare_resolves_the_first_hyundai_from_memory(catalog, monkeypatch) -> None:
    """Regression: "compare the first car you suggested from hyundai" looked up the Tesla Roadster instead."""
    monkeypatch.setattr(get_settings(), "ai_enable_web_search", False)
    graph = main_agent(session=AsyncMock())
    generate = AsyncMock(side_effect=[_FakeLlmResult("compare"), _FakeLlmResult('{"calls": []}'), _FakeLlmResult("ok")])
    with patch("src.agents.llm.LlmClient.generate", new=generate):
        await graph.ainvoke(
            {
                "user_id": "u1",
                "thread_id": "t1",
                "message": "fine i want to compare the first car you suggested from hyundai brand",
                "conversation_context": [
                    {"role": "user", "body": "fine tell me about the tesla roadster model"},
                    {"role": "user", "body": "i want tesla flying car"},
                ],
                "chat_summary": _hyundai_chat_summary(),
            }
        )

    looked_up = catalog.await_args.args[1]
    assert looked_up.startswith("Hyundai Palisade Hybrid.")
    assert "roadster" not in looked_up.lower()
    assert "Cars Sera suggested, in order" in generate.await_args_list[0].args[0]  # every step sees the memory


async def test_a_model_named_in_an_earlier_message_is_not_looked_up_as_missing(catalog, monkeypatch) -> None:
    """The Tesla Roadster mentioned two messages ago must not turn a new comparison into a Roadster search."""
    monkeypatch.setattr(get_settings(), "ai_enable_web_search", True)

    async def match(_session, text):
        return (
            MatchResult(make=SimpleNamespace(name="Tesla"), unknown_model="roadster")
            if "roadster" in text
            else MatchResult()
        )

    catalog.side_effect = match
    graph = main_agent(session=AsyncMock())
    get_urls = AsyncMock(return_value=[])
    generate = AsyncMock(side_effect=[_FakeLlmResult("compare"), _FakeLlmResult('{"calls": []}'), _FakeLlmResult("ok")])
    with (
        patch("src.agents.llm.LlmClient.generate", new=generate),
        patch("src.agents.serra.graph.get_urls", new=get_urls),
    ):
        result = await graph.ainvoke(
            {
                "user_id": "u1",
                "thread_id": "t1",
                "message": "compare them",
                "conversation_context": [{"role": "user", "body": "tell me about the tesla roadster"}],
            }
        )

    assert not result.get("named_model_missing")


def test_web_search_gets_the_resolved_car_when_the_orchestrator_was_skipped() -> None:
    query = build_web_query(
        "compare the first car you suggested from hyundai brand", chat_summary=_hyundai_chat_summary()
    )
    assert "Meaning: the Hyundai Palisade Hybrid" in query


async def test_each_saved_turn_carries_the_updated_memory() -> None:
    session = AsyncMock()
    session.add = MagicMock()
    payload = SimpleNamespace(
        message="can you tell me top 5 good cars",
        preference_action=None,
        request_context=None,
        agent="sera-agent",
        entry_mode=None,
        chat_preferences=None,
    )
    await AiService(session)._save_checkpoint(
        "t1", "u1", payload, {"answer": TOP_FIVE, "route": "advice"}, {}, {"chat_summary": None}
    )
    saved = session.add.call_args.args[0].checkpoint["chat_summary"]
    assert [car["name"] for car in saved["cars_suggested"]][2] == "Hyundai Palisade Hybrid"


async def test_background_refinement_adds_likes_and_notes_to_the_newest_turn() -> None:
    from src.database import SessionFactory
    from src.repositories.schema import ConversationHistory

    thread_id = str(uuid4())
    summary = update_summary(None, user_message="I want something unique", answer=TOP_FIVE, route="advice")
    async with SessionFactory() as session:
        session.add(
            ConversationHistory(
                thread_id=thread_id,
                checkpoint_id=str(uuid4()),
                user_id=BUYER_ID,
                thread_type="sera",
                checkpoint={"user": "I want something unique", "assistant": TOP_FIVE, "chat_summary": summary},
                metadata_json={},
            )
        )
        await session.commit()

    reply = (
        '{"likes": ["unique, attention-grabbing"], "dislikes": ["too common"], "uses": [], "notes": "Wants status."}'
    )
    fake = SimpleNamespace(generate=AsyncMock(return_value=_FakeLlmResult(reply)))
    with patch("src.services.ai_service.LlmClient", return_value=fake):
        await _refine_chat_memory(thread_id, BUYER_ID, "I want something unique", TOP_FIVE)

    async with SessionFactory() as session:
        row = (
            await session.execute(select(ConversationHistory).where(ConversationHistory.thread_id == thread_id))
        ).scalar_one()
    memory = row.checkpoint["chat_summary"]
    assert memory["likes"] == ["unique, attention-grabbing"] and memory["dislikes"] == ["too common"]
    assert memory["notes"] == "Wants status."
    assert [car["name"] for car in memory["cars_suggested"]][2] == "Hyundai Palisade Hybrid"  # facts kept


async def test_a_failed_refinement_leaves_the_memory_untouched() -> None:
    fake = SimpleNamespace(generate=AsyncMock(return_value=_FakeLlmResult("not json")))
    with patch("src.services.ai_service.LlmClient", return_value=fake):
        await _refine_chat_memory(str(uuid4()), BUYER_ID, "hi", "hello")  # no row: returns quietly


@pytest.mark.parametrize(
    "message",
    ["what does a CPO warranty cover", "what is the difference between AWD and 4WD", "tell me about the Tucson hybrid"],
)
def test_questions_about_a_feature_are_not_remembered_as_wants(message: str) -> None:
    """Regression (live run): a question about CPO warranties was stored as "wants a certified pre-owned car"."""
    assert update_summary(None, user_message=message, answer="")["buyer"] == {}


def test_stated_wants_and_any_budget_are_remembered() -> None:
    buyer = update_summary(None, user_message="I prefer a hybrid, make it white", answer="")["buyer"]
    assert (buyer["fuel_type"], buyer["color"]) == ("Hybrid", "White")
    assert update_summary(None, user_message="best SUV under 35k?", answer="")["buyer"] == {"budget_max": "35000"}


async def test_an_orchestrator_plan_cut_off_by_the_output_limit_keeps_its_mode(catalog, monkeypatch) -> None:
    """Regression (live run): '{"mode":"kb_only",...,"search_query":"What budget…' (cut off) failed the turn."""
    monkeypatch.setattr(get_settings(), "ai_enable_web_search", False)
    graph = main_agent(session=AsyncMock())
    truncated = '{"mode":"kb_only","reasoning":"Recall details.","search_query":"What budget and color did I'
    generate = AsyncMock(
        side_effect=[
            _FakeLlmResult("advice"),
            _FakeLlmResult(truncated),
            _FakeLlmResult('{"calls": []}'),
            _FakeLlmResult("ok"),
        ]
    )
    with patch("src.agents.llm.LlmClient.generate", new=generate):
        result = await graph.ainvoke({"user_id": "u1", "thread_id": "t1", "message": "what budget did I tell you?"})
    assert result["mode"] == "kb_only"
    assert result["answer"] == "ok"
