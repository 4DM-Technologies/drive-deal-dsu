import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.administration_service import AdministrationService
from src.services.ai_service import AiService
from src.services.catalog.matcher import MatchResult
from src.utils.exceptions import AppError


def _graph(result: dict, started: list[str], name: str, delay: float = 0.0):
    async def ainvoke(state):
        started.append(name)
        if delay:
            import asyncio

            await asyncio.sleep(delay)
        return result

    return SimpleNamespace(ainvoke=ainvoke)


def _payload(message: str, **overrides) -> SimpleNamespace:
    return SimpleNamespace(
        **{
            "thread_id": "t1",
            "agent": "sera",
            "message": message,
            "request_ids": [],
            "quote_ids": [],
            "request_context": None,
            "preference_action": None,
            "chat_preferences": None,
            "entry_mode": None,
            **overrides,
        }
    )


async def _drain(
    message: str,
    main_result: dict,
    main_delay: float = 0.0,
    *,
    memory: dict | None = None,
    saved_preferences: dict | None = None,
    states: list[dict] | None = None,
    match_mock: AsyncMock | None = None,
    requirement_output: dict | None = None,
    requirement_states: list[dict] | None = None,
    **payload_overrides,
):
    started: list[str] = []
    main = _graph(main_result, started, "main", main_delay)
    if states is not None:
        record = main.ainvoke

        async def ainvoke(state):
            states.append(state)
            return await record(state)

        main = SimpleNamespace(ainvoke=ainvoke)
    requirements = _graph(
        requirement_output or {"requirements": {"budget": 40000}, "suggested_questions": ["q"]},
        started,
        "requirements",
        0.0 if requirement_output else 5.0,
    )
    if requirement_states is not None:
        record_requirements = requirements.ainvoke

        async def requirements_ainvoke(state):
            requirement_states.append(state)
            return await record_requirements(state)

        requirements = SimpleNamespace(ainvoke=requirements_ainvoke)
    session = AsyncMock()
    session.add = MagicMock()

    with (
        patch("src.services.ai_service.main_agent", return_value=main),
        patch("src.services.ai_service.build_requirement_graph", return_value=requirements),
        patch(
            "src.services.ai_service.get_settings",
            return_value=SimpleNamespace(ai_disabled=False, ai_enable_web_search=True),
        ),
        patch("src.services.ai_service.match_message", new=match_mock or AsyncMock(return_value=MatchResult())),
        patch.object(
            AdministrationService,
            "runtime_bundle",
            new=AsyncMock(return_value={"version": "test", "workflow": {}, "prompts": {}, "agent_profiles": {}}),
        ),
        patch.object(AiService, "_finish_trace", new=AsyncMock()),
        patch.object(AiService, "_latest_memory", new=AsyncMock(return_value=memory or {})),
        patch.object(AiService, "_buyer_preferences", new=AsyncMock(return_value=saved_preferences or {})),
        patch.object(AiService, "_save_checkpoint", new=AsyncMock()),
    ):
        service = AiService(session=session)
        started_at = time.perf_counter()
        payload = _payload(message, **payload_overrides)
        events = [event async for event in service.stream_chat(payload, SimpleNamespace(id="u1"))]
    return started, events, time.perf_counter() - started_at


async def test_greeting_never_starts_the_requirements_graph() -> None:
    """A greeting has no requirement to extract, so the parallel requirements graph must not be started.

    This is the regression behind the 12.8s "hey serra, how are you" turn: the requirements call was still
    awaited through asyncio.gather and gated the reply."""
    started, events, _ = await _drain(
        "hey serra, how are you",
        {"route": "small_talk", "answer": "Doing well - how can I help with your car search?"},
    )

    assert started == ["main"]
    assert not any(event.get("phase") == "searching" for event in events)
    assert "Doing well - how can I help with your car search?" == "".join(
        e["text"] for e in events if e["type"] == "token"
    )


async def test_explicit_vehicle_search_starts_only_web_pipeline() -> None:
    started, events, _ = await _drain(
        "Can you search Tesla cars tell me about it.",
        {
            "route": "web_search",
            "mode": "web_direct",
            "answer": "Tesla currently offers several models.",
            "sources": [{"title": "Tesla", "url": "https://www.tesla.com/"}],
        },
    )

    assert started == ["main"]
    assert events[0] == {"type": "status", "phase": "crawling", "label": "Searching trusted sources"}
    assert not any(event.get("kind") == "requestPreview" for event in events)


async def test_out_of_scope_message_stops_waiting_for_requirements() -> None:
    """The classifier may only rule out of scope *after* the parallel requirements task was created, so the
    reply must no longer wait on it: a 5s requirements graph must not delay a one-call answer."""
    started, events, elapsed = await _drain(
        "tell me a joke about cats", {"route": "off_topic", "answer": "Let's talk cars."}
    )

    assert "main" in started
    assert elapsed < 1.0, f"reply waited {elapsed}s on the cancelled requirements graph"
    assert not any(event.get("phase") == "searching" for event in events)


@pytest.mark.parametrize("message", ["find me a sedan under 40k", "compare my two quotes"])
async def test_vehicle_questions_still_run_both_graphs(message: str) -> None:
    started, events, _ = await _drain(message, {"route": "advice", "answer": "Here are options."})

    assert sorted(started) == ["main", "requirements"]
    assert any(event.get("phase") == "searching" for event in events)


async def test_compare_chat_passes_selected_offers_to_the_agent_and_card() -> None:
    captured_states: list[dict] = []

    async def invoke(state: dict) -> dict:
        captured_states.append(state)
        return {"route": "compare", "answer": "## Best value\nChoose Dealer One."}

    comparison = {
        "requestIds": ["r1"],
        "quoteIds": ["q1", "q2"],
        "rows": [
            {"id": "q1", "dealer_name": "Dealer One", "final_price": 31000},
            {"id": "q2", "dealer_name": "Dealer Two", "final_price": 32500},
        ],
    }
    payload = SimpleNamespace(
        thread_id="t1",
        agent="compare-agent",
        message="Compare these selected dealer offers.",
        request_ids=[],
        quote_ids=["q1", "q2"],
        request_context=None,
        preference_action=None,
        chat_preferences=None,
        entry_mode=None,
    )
    requirements_builder = MagicMock()
    session = AsyncMock()
    session.add = MagicMock()

    with (
        patch("src.services.ai_service.main_agent", return_value=SimpleNamespace(ainvoke=invoke)),
        patch("src.services.ai_service.build_requirement_graph", requirements_builder),
        patch(
            "src.services.ai_service.get_settings",
            return_value=SimpleNamespace(ai_disabled=False, ai_enable_web_search=True),
        ),
        patch("src.services.ai_service.match_message", new=AsyncMock(return_value=MatchResult())),
        patch.object(
            AdministrationService,
            "runtime_bundle",
            new=AsyncMock(return_value={"version": "test", "workflow": {}, "prompts": {}, "agent_profiles": {}}),
        ),
        patch.object(AiService, "_finish_trace", new=AsyncMock()),
        patch.object(AiService, "_latest_memory", new=AsyncMock(return_value={})),
        patch.object(AiService, "_comparison_payload", new=AsyncMock(return_value=comparison)),
        patch.object(AiService, "_save_checkpoint", new=AsyncMock()),
    ):
        events = [event async for event in AiService(session).stream_chat(payload, SimpleNamespace(id="u1"))]

    assert captured_states[0]["comparison_rows"] == comparison["rows"]
    requirements_builder.assert_not_called()
    assert next(event for event in events if event.get("kind") == "compare")["payload"] == comparison
    assert "Choose Dealer One" in "".join(event["text"] for event in events if event["type"] == "token")


async def test_latest_memory_keeps_recent_chat_context_for_follow_up_questions() -> None:
    latest = SimpleNamespace(
        checkpoint={"user": "compare both", "assistant": "Which cars?", "request_context": {"model": "K4"}}
    )
    previous = SimpleNamespace(
        checkpoint={"user": "I want a 2026 Hyundai Venue and Kia K4", "assistant": "Pick the two cars."}
    )
    result = MagicMock()
    result.scalars.return_value.all.return_value = [latest, previous]
    session = AsyncMock()
    session.execute.return_value = result

    memory = await AiService(session)._latest_memory("t1", "u1")

    assert memory["request_context"] == {"model": "K4"}
    assert memory["conversation_context"] == [
        {"role": "user", "body": "I want a 2026 Hyundai Venue and Kia K4"},
        {"role": "assistant", "body": "Pick the two cars."},
        {"role": "user", "body": "compare both"},
        {"role": "assistant", "body": "Which cars?"},
    ]


async def test_checkpoint_keeps_request_context_when_follow_up_does_not_repeat_it() -> None:
    session = AsyncMock()
    session.add = MagicMock()
    payload = _payload("compare both")
    await AiService(session)._save_checkpoint(
        "t1",
        "u1",
        payload,
        {"answer": "Here is the comparison."},
        {},
        {"request_context": {"brand": "Kia", "model": "K4"}, "preferences": {"transmission": "Automatic"}},
    )

    saved = session.add.call_args.args[0].checkpoint
    assert saved["request_context"] == {"brand": "Kia", "model": "K4"}
    assert saved["preferences"] == {"transmission": "Automatic"}


SAVED = {"body_type": "SUV", "fuel_type": "Hybrid"}


def _preference_cards(events: list[dict]) -> list[dict]:
    return [event for event in events if event.get("kind") == "preference"]


@pytest.mark.parametrize("message", ["best sports cars", "Is a hybrid SUV worth it for a family?"])
async def test_ask_mode_offers_saved_preferences_on_first_vehicle_question(message: str) -> None:
    started, events, _ = await _drain(
        message, {"route": "advice", "answer": "x"}, saved_preferences=SAVED, entry_mode="ask"
    )

    assert len(_preference_cards(events)) == 1
    assert started == []


async def test_preferences_card_is_not_offered_again_in_the_same_chat() -> None:
    started, events, _ = await _drain(
        "recommend a family SUV",
        {"route": "advice", "answer": "Here are options."},
        memory={"entry_mode": "ask", "preference_prompted": True},
        saved_preferences=SAVED,
    )

    assert not _preference_cards(events)
    assert "main" in started


@pytest.mark.parametrize("entry_mode", [None, "guided"])
async def test_preferences_card_is_never_offered_outside_ask_mode(entry_mode: str | None) -> None:
    _, events, _ = await _drain(
        "best sports cars", {"route": "advice", "answer": "x"}, saved_preferences=SAVED, entry_mode=entry_mode
    )

    assert not _preference_cards(events)


@pytest.mark.parametrize("message", ["hey sera", "how are you"])
async def test_preferences_card_is_not_offered_on_a_greeting(message: str) -> None:
    _, events, _ = await _drain(
        message, {"route": "small_talk", "answer": "Hi!"}, saved_preferences=SAVED, entry_mode="ask"
    )

    assert not _preference_cards(events)


async def test_stored_entry_mode_wins_over_the_request() -> None:
    _, events, _ = await _drain(
        "best sports cars",
        {"route": "advice", "answer": "x"},
        memory={"entry_mode": "guided"},
        saved_preferences=SAVED,
        entry_mode="ask",
    )

    assert not _preference_cards(events)


async def test_use_saved_choice_applies_to_later_questions_in_the_chat() -> None:
    states: list[dict] = []
    await _drain(
        "what about a hybrid SUV?",
        {"route": "advice", "answer": "x"},
        memory={"entry_mode": "ask", "preference_prompted": True, "preference_action": "use_saved"},
        saved_preferences=SAVED,
        states=states,
    )

    assert states[0]["preferences"] == SAVED


async def test_checkpoint_remembers_the_card_was_offered_and_the_buyer_choice() -> None:
    session = AsyncMock()
    session.add = MagicMock()
    service = AiService(session)

    await service._save_checkpoint(
        "t1", "u1", _payload("best sports cars", entry_mode="ask"), {"route": "preference_choice"}, {}, {}
    )
    offered = session.add.call_args.args[0].checkpoint
    assert offered["preference_prompted"] is True
    assert offered["entry_mode"] == "ask"

    await service._save_checkpoint(
        "t1", "u1", _payload("Use my saved preferences.", preference_action="use_saved"), {"answer": "x"}, {}, offered
    )
    chosen = session.add.call_args.args[0].checkpoint
    assert chosen["preference_action"] == "use_saved"
    assert chosen["preference_prompted"] is True

    await service._save_checkpoint("t1", "u1", _payload("and a cheaper one?"), {"answer": "y"}, {}, chosen)
    later = session.add.call_args.args[0].checkpoint
    assert later["preference_action"] == "use_saved"
    assert later["preference_prompted"] is True
    assert later["entry_mode"] == "ask"


EARLIER_QUESTION = {"role": "user", "body": "i crashed my audi, how can i get insurance"}


async def test_no_cards_after_the_first_question() -> None:
    match = AsyncMock(return_value=MatchResult())
    started, events, _ = await _drain(
        "my audi is 35K, will i be able to buy a home for that same amount",
        {"route": "off_topic", "answer": "That's outside what I can help with."},
        memory={"entry_mode": "ask", "conversation_context": [EARLIER_QUESTION]},
        saved_preferences=SAVED,
        match_mock=match,
    )

    assert started == ["main"]
    match.assert_not_awaited()
    assert not any(event["type"] == "card" for event in events)


async def test_greetings_do_not_use_up_the_first_question() -> None:
    _, events, _ = await _drain(
        "best family SUV under 40k",
        {"route": "advice", "answer": "x"},
        memory={"entry_mode": "ask", "conversation_context": [{"role": "user", "body": "hi"}]},
        saved_preferences=SAVED,
    )

    assert len(_preference_cards(events)) == 1


async def test_preference_button_continues_the_first_question_with_its_cards() -> None:
    match = AsyncMock(return_value=MatchResult())
    started, _, _ = await _drain(
        "Use my saved preferences for this chat.",
        {"route": "advice", "answer": "x"},
        memory={
            "entry_mode": "ask",
            "preference_prompted": True,
            "active_request": "best family SUV under 40k",
            "conversation_context": [{"role": "user", "body": "best family SUV under 40k"}],
        },
        saved_preferences=SAVED,
        match_mock=match,
        preference_action="use_saved",
    )

    assert sorted(started) == ["main", "requirements"]
    match.assert_awaited_once()


COMPARED_CARS = {
    "entry_mode": "ask",
    "preference_prompted": True,
    "requirements": {"brand": "Honda", "model": "Accord", "buyer_area": "Austin", "state": "Texas"},
    "conversation_context": [
        {"role": "user", "body": "compare the Toyota Camry and Honda Accord"},
        {"role": "assistant", "body": "The Camry is more efficient; the Accord has more rear legroom."},
    ],
}


async def test_settling_on_a_car_later_in_the_chat_shows_an_editable_request_card() -> None:
    requirement_states: list[dict] = []
    started, events, _ = await _drain(
        "I'm good with the Camry, post a request for it",
        {"route": "requirements", "answer": "Great choice - your request is ready below."},
        memory=COMPARED_CARS,
        requirement_output={
            "requirements": {"brand": "Toyota", "model": "Camry", "buyer_area": "Austin", "state": "Texas"},
            "missing_fields": ["timeline"],
            "suggested_questions": [{"field": "timeline"}],
        },
        requirement_states=requirement_states,
    )

    assert started == ["main", "requirements"]
    assert requirement_states[0]["vehicle_selection"] is True
    card = next(event for event in events if event.get("kind") == "requestPreview")
    assert card["payload"]["model"] == "Camry"
    assert card["payload"]["confirmation_required"] is True
    assert "questions" not in card["payload"]


async def test_ordinary_later_question_still_gets_no_request_card() -> None:
    started, events, _ = await _drain(
        "which one has better rear seats?",
        {"route": "advice", "answer": "The Accord."},
        memory=COMPARED_CARS,
        requirement_output={"requirements": {"brand": "Toyota"}},
    )

    assert started == ["main"]
    assert not any(event["type"] == "card" for event in events)


async def test_a_new_request_card_replaces_the_request_already_posted() -> None:
    session = AsyncMock()
    session.add = MagicMock()
    posted = {"published_request": {"id": "r1"}, "published_request_id": "r1"}

    await AiService(session)._save_checkpoint(
        "t1",
        "u1",
        _payload("I'm good with the Camry"),
        {"answer": "x", "route": "requirements"},
        {"requirements": {"brand": "Toyota", "model": "Camry"}, "vehicle_selection": True},
        posted,
    )
    saved = session.add.call_args.args[0].checkpoint
    assert saved["published_request"] is None
    assert saved["published_request_id"] is None
    assert saved["requirements"] == {"brand": "Toyota", "model": "Camry"}

    await AiService(session)._save_checkpoint("t1", "u1", _payload("thanks"), {"answer": "y"}, {}, posted)
    assert session.add.call_args.args[0].checkpoint["published_request_id"] == "r1"


async def test_delete_thread_removes_only_an_owned_chat() -> None:
    found = MagicMock()
    found.scalar_one_or_none.return_value = "t1"
    session = AsyncMock()
    session.execute.side_effect = [found, MagicMock()]

    await AiService(session).delete_thread("t1", SimpleNamespace(id="u1"))

    assert session.execute.await_count == 2
    for call in session.execute.await_args_list:
        statement = call.args[0]
        assert "conversation_history.user_id" in str(statement)
    session.commit.assert_awaited_once()


async def test_delete_thread_hides_missing_or_unowned_chats() -> None:
    missing = MagicMock()
    missing.scalar_one_or_none.return_value = None
    session = AsyncMock()
    session.execute.return_value = missing

    with pytest.raises(AppError) as error:
        await AiService(session).delete_thread("someone-elses-thread", SimpleNamespace(id="u1"))

    assert error.value.status_code == 404
    session.commit.assert_not_awaited()
