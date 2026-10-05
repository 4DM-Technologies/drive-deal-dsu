import asyncio
import json
import re
from pathlib import Path

from langgraph.graph import END, START, StateGraph
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.agents.checkpointer import get_checkpointer
from src.agents.errors import OrchestratorPlanError
from src.agents.llm import LlmClient
from src.agents.observability import log_agent_step
from src.agents.prompts import load_prompt
from src.agents.schemas import CarSpecs, OrchestratorPlan
from src.agents.state import AgentState
from src.agents.tools.kb import kb_insert, kb_search
from src.agents.tools.kb_db import query_data, update_preferences, write_car
from src.agents.tools.web_search import get_urls, process_url
from src.repositories.schema import Brand, State
from src.utils.logger import logger

PROMPT_ROOT = Path(__file__).resolve().parents[2] / "prompt"


def _extract_json(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    return json.loads(match.group(0) if match else text)


def _extract_json_array(text: str) -> list:
    match = re.search(r"\[.*\]", text, re.DOTALL)
    return json.loads(match.group(0) if match else text)


async def _fetch_preferences(session: AsyncSession, user_id: str) -> dict:
    """Returns only the JSON-serializable fields the agent needs - the raw row also carries
    created_at/updated_at datetimes, which would break the conversation-checkpoint JSON save."""
    rows = await query_data(session, "buyer_preference", {"profile_id": user_id}, limit=1)
    if not rows:
        return {}
    return {"profile_id": rows[0]["profile_id"], "preferences": rows[0].get("preferences") or []}


def main_agent(session: AsyncSession, compare: bool = False):
    """Builds Serra's agent graph:

    START -> classifier -> orchestrator -+-> kb_agent -+-> compose
                                          |             +-> (missing prefs) -> compose
                                          +-> web_search_agent (web_direct) -> persist_cars -> compose
                                          (kb_agent) -> web_search_agent (web_per_car) -> persist_cars -> compose
    """
    llm = LlmClient(session)
    compose_prompt = load_prompt("compose.md")
    compare_prompt = (PROMPT_ROOT / "compare.md").read_text(encoding="utf-8")

    async def classify(state: AgentState) -> AgentState:
        step = log_agent_step("serra", "classifier", state, compare=compare)
        if compare:
            return {"route": "compare", "step": step}
        result = await llm.generate(f"Classify as advice, compare, or requirements.\nUSER: {state['message']}", "classifier", state.get("thread_id"))
        return {"route": result.text.strip().lower(), "step": step}

    async def orchestrate(state: AgentState) -> AgentState:
        step = log_agent_step("serra", "orchestrator", state, route=state.get("route"))
        if state.get("route") == "compare":
            return {"mode": "kb_only", "step": step}

        preferences = state.get("preferences") or await _fetch_preferences(session, state["user_id"])
        prompt = (
            f"{load_prompt('orchestrator.md')}\n\n"
            f"ROUTE: {state.get('route')}\nUSER MESSAGE: {state['message']}\n"
            f"KNOWN PREFERENCES: {preferences or 'none'}\nPREFERENCES_PENDING: {state.get('preferences_pending', False)}"
        )
        result = await llm.generate(prompt, "orchestrator", state.get("thread_id"))
        try:
            plan = OrchestratorPlan.model_validate(_extract_json(result.text))
        except Exception as exc:
            raise OrchestratorPlanError(f"Orchestrator produced an unparsable plan for thread {state.get('thread_id')}: {result.text[:200]!r}") from exc
        logger.info("agent_orchestrator_plan", thread_id=state.get("thread_id"), mode=plan.mode, reasoning=plan.reasoning)
        return {"mode": plan.mode, "preferences": preferences, "step": step}

    async def route_from_orchestrator(state: AgentState) -> str:
        if state.get("route") == "compare":
            return "compose"
        return "web_search_agent" if state.get("mode") == "web_direct" else "kb_agent"

    async def knowledge(state: AgentState) -> AgentState:
        step = log_agent_step("serra", "kb_agent", state, mode=state.get("mode"))
        preferences = state.get("preferences") or {}
        preferences_pending = state.get("preferences_pending", False)

        if preferences_pending:
            extraction_prompt = f"{load_prompt('kb_agent.md')}\n\nExtract must-have car features as a JSON array of short strings from this buyer reply:\n{state['message']}"
            result = await llm.generate(extraction_prompt, "preference_extraction", state.get("thread_id"))
            try:
                features = [str(item) for item in _extract_json_array(result.text)]
            except Exception:
                features = [state["message"].strip()]
            preferences = await update_preferences(session, state["user_id"], features)
            preferences_pending = False
        elif not preferences:
            question = "Do you have any preferences I should know about — brand, budget, body type, or must-have features?"
            return {"answer": question, "preferences": {}, "preferences_pending": True, "kb_results": [], "step": step}

        query = f"{state['message']} {' '.join(preferences.get('preferences') or [])}".strip()
        kb_results = await kb_search(session, query)
        update: AgentState = {"kb_results": kb_results, "preferences": preferences, "preferences_pending": preferences_pending, "step": step}

        if state.get("mode") == "web_per_car":
            shortlist_prompt = (
                f"{load_prompt('kb_agent.md')}\n\nUSER QUESTION: {state['message']}\nKNOWN PREFERENCES: {preferences}\n"
                f"LOCAL INVENTORY MATCHES: {kb_results}\n\nReturn a JSON array of 3-6 specific car names (make + model, "
                "optionally year range) that best fit this ask."
            )
            shortlist_result = await llm.generate(shortlist_prompt, "car_shortlist", state.get("thread_id"))
            try:
                update["car_names"] = [str(name) for name in _extract_json_array(shortlist_result.text)]
            except Exception:
                update["car_names"] = []
        return update

    async def after_kb(state: AgentState) -> str:
        if state.get("preferences_pending"):
            return "compose"
        return "web_search_agent" if state.get("mode") == "web_per_car" else "compose"

    async def _resolve_one(name: str, preferences: dict, thread_id: str | None) -> CarSpecs | None:
        make = (name.split() or [""])[0]
        candidates = await get_urls(name, make=make)
        for candidate in candidates:
            specs = await process_url(llm, candidate["url"], thread_id)
            if specs:
                return specs
        return None

    async def search_web(state: AgentState) -> AgentState:
        step = log_agent_step("serra", "web_search_agent", state, mode=state.get("mode"))
        thread_id = state.get("thread_id")
        preferences = state.get("preferences") or {}
        specs: list[CarSpecs] = []

        if state.get("mode") == "web_per_car" and state.get("car_names"):
            results = await asyncio.gather(*[_resolve_one(name, preferences, thread_id) for name in state["car_names"]])
            specs = [spec for spec in results if spec]
        else:
            query_terms = [state["message"]] + [str(value) for value in preferences.values() if value]
            candidates = await get_urls(" ".join(query_terms))
            for candidate in candidates[:3]:
                spec = await process_url(llm, candidate["url"], thread_id)
                if spec:
                    specs.append(spec)

        sources = [{"title": spec.model or spec.source_url, "url": spec.source_url} for spec in specs]
        if specs:
            await kb_insert(session, state["message"], [{"title": s.model or s.source_url, "url": s.source_url, "content": s.model_dump()} for s in specs], state["user_id"])
        return {"car_specs": [spec.model_dump() for spec in specs], "web_results": [spec.model_dump() for spec in specs], "sources": sources, "step": step}

    async def persist_cars(state: AgentState) -> AgentState:
        step = log_agent_step("serra", "persist_cars", state, count=len(state.get("car_specs") or []))
        persisted = []
        for spec in state.get("car_specs") or []:
            if not spec.get("make") or not spec.get("model") or not spec.get("year") or not spec.get("price_usd"):
                continue
            brand = (await session.execute(select(Brand).where(Brand.name.ilike(spec["make"])))).scalars().first()
            state_row = (await session.execute(select(State).limit(1))).scalars().first()
            if not brand or not state_row:
                continue
            result = await write_car(
                session, brand_id=brand.id, state_id=state_row.id,
                model=spec["model"], model_year=int(spec["year"]), price=float(spec["price_usd"]),
                body_type=spec.get("trim"), mileage=spec.get("mileage") or 0, fuel=spec.get("fuel_type"),
                transmission=spec.get("transmission"),
            )
            persisted.append(result)
        logger.info("agent_persist_cars", thread_id=state.get("thread_id"), persisted=persisted)
        return {"step": step}

    async def compose(state: AgentState) -> AgentState:
        step = log_agent_step("serra", "compose", state)
        if state.get("answer") and state.get("preferences_pending"):
            return {"step": step}  # kb_agent already produced the clarifying question as the final answer

        is_compare = compare or state.get("route") == "compare"
        system_prompt = compare_prompt if is_compare else compose_prompt
        kb_block = f'<knowledge_base trust="internal">{state.get("kb_results") or []}</knowledge_base>'
        web_block = f'<web_research trust="untrusted">{state.get("car_specs") or state.get("web_results") or []}</web_research>'
        prompt = f"{system_prompt}\n\nUSER QUESTION:\n{state['message']}\n\n{kb_block}\n\n{web_block}"
        result = await llm.generate(prompt, "compare" if is_compare else "advisor", state.get("thread_id"))
        return {"answer": result.text, "step": step}

    graph = StateGraph(AgentState)
    graph.add_node("classifier", classify)
    graph.add_node("orchestrator", orchestrate)
    graph.add_node("kb_agent", knowledge)
    graph.add_node("web_search_agent", search_web)
    graph.add_node("persist_cars", persist_cars)
    graph.add_node("compose", compose)

    graph.add_edge(START, "classifier")
    graph.add_edge("classifier", "orchestrator")
    graph.add_conditional_edges("orchestrator", route_from_orchestrator, {"kb_agent": "kb_agent", "web_search_agent": "web_search_agent", "compose": "compose"})
    graph.add_conditional_edges("kb_agent", after_kb, {"web_search_agent": "web_search_agent", "compose": "compose"})
    graph.add_edge("web_search_agent", "persist_cars")
    graph.add_edge("persist_cars", "compose")
    graph.add_edge("compose", END)
    return graph.compile(checkpointer=get_checkpointer())
