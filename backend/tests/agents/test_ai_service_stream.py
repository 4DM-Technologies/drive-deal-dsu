import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.ai_service import AiService
from src.utils.exceptions import AppError


def _graph(result: dict, started: list[str], name: str, delay: float = 0.0):
    async def ainvoke(state):
        started.append(name)
        if delay:
            import asyncio

            await asyncio.sleep(delay)
        return result

    return SimpleNamespace(ainvoke=ainvoke)


def _payload(message: str) -> SimpleNamespace:
    return SimpleNamespace(thread_id="t1", agent="sera", message=message, request_ids=[], quote_ids=[])


async def _drain(message: str, main_result: dict, main_delay: float = 0.0):
    started: list[str] = []
    main = _graph(main_result, started, "main", main_delay)
    requirements = _graph({"requirements": {"budget": 40000}, "suggested_questions": ["q"]}, started, "requirements", 5.0)

    with patch("src.services.ai_service.main_agent", return_value=main), \
         patch("src.services.ai_service.build_requirement_graph", return_value=requirements), \
         patch("src.services.ai_service.get_settings", return_value=SimpleNamespace(ai_disabled=False)), \
         patch.object(AiService, "_latest_memory", new=AsyncMock(return_value={})), \
         patch.object(AiService, "_save_checkpoint", new=AsyncMock()):
        service = AiService(session=AsyncMock())
        started_at = time.perf_counter()
        events = [event async for event in service.stream_chat(_payload(message), SimpleNamespace(id="u1"))]
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
    assert "Doing well - how can I help with your car search?" == "".join(e["text"] for e in events if e["type"] == "token")


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
    started, events, elapsed = await _drain("tell me a joke about cats", {"route": "off_topic", "answer": "Let's talk cars."})

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
    )
    requirements_builder = MagicMock()

    with patch("src.services.ai_service.main_agent", return_value=SimpleNamespace(ainvoke=invoke)), \
         patch("src.services.ai_service.build_requirement_graph", requirements_builder), \
         patch("src.services.ai_service.get_settings", return_value=SimpleNamespace(ai_disabled=False)), \
         patch.object(AiService, "_latest_memory", new=AsyncMock(return_value={})), \
         patch.object(AiService, "_comparison_payload", new=AsyncMock(return_value=comparison)), \
         patch.object(AiService, "_save_checkpoint", new=AsyncMock()):
        events = [event async for event in AiService(AsyncMock()).stream_chat(payload, SimpleNamespace(id="u1"))]

    assert captured_states[0]["comparison_rows"] == comparison["rows"]
    requirements_builder.assert_not_called()
    assert next(event for event in events if event.get("kind") == "compare")["payload"] == comparison
    assert "Choose Dealer One" in "".join(event["text"] for event in events if event["type"] == "token")


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
