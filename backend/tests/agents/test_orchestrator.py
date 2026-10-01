from dataclasses import dataclass
from unittest.mock import AsyncMock, patch

import pytest

from src.agents.errors import OrchestratorPlanError
from src.agents.serra.graph import main_agent


@dataclass
class _FakeLlmResult:
    text: str


async def test_orchestrator_raises_on_unparsable_plan() -> None:
    """The orchestrator must fail loudly (not silently fall back) when its LLM output doesn't parse
    against OrchestratorPlan - an explicit, non-negotiable requirement from the design brief."""
    graph = main_agent(session=AsyncMock())
    with patch("src.agents.llm.LlmClient.generate", new=AsyncMock(return_value=_FakeLlmResult("not json at all"))), \
         patch("src.agents.serra.graph._fetch_preferences", new=AsyncMock(return_value={})):
        with pytest.raises(OrchestratorPlanError):
            await graph.ainvoke({"user_id": "u1", "thread_id": "t1", "message": "top 5 SUVs under $40k"})


async def test_orchestrator_raises_on_wrong_mode_value() -> None:
    graph = main_agent(session=AsyncMock())
    with patch("src.agents.llm.LlmClient.generate", new=AsyncMock(return_value=_FakeLlmResult('{"mode": "do_whatever"}'))), \
         patch("src.agents.serra.graph._fetch_preferences", new=AsyncMock(return_value={})):
        with pytest.raises(OrchestratorPlanError):
            await graph.ainvoke({"user_id": "u1", "thread_id": "t1", "message": "top 5 SUVs under $40k"})


async def test_orchestrator_accepts_a_valid_plan() -> None:
    graph = main_agent(session=AsyncMock())
    responses = [
        _FakeLlmResult("advice"),  # classifier
        _FakeLlmResult('{"mode": "kb_only", "reasoning": "answerable locally"}'),  # orchestrator
        _FakeLlmResult("Here is my answer."),  # compose
    ]
    with patch("src.agents.llm.LlmClient.generate", new=AsyncMock(side_effect=responses)), \
         patch("src.agents.serra.graph._fetch_preferences", new=AsyncMock(return_value={"brand": "Ford"})), \
         patch("src.agents.serra.graph.kb_search", new=AsyncMock(return_value=[])):
        result = await graph.ainvoke({"user_id": "u1", "thread_id": "t1", "message": "what cars do you have"})
    assert result["mode"] == "kb_only"
    assert result["answer"] == "Here is my answer."
