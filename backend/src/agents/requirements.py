import re

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.agents.llm import LlmClient
from src.agents.observability import log_agent_step
from src.agents.prompts import load_prompt
from src.agents.state import AgentState
from src.repositories.schema import Brand, State
from src.utils.logger import logger

REQUIRED = ["brand", "model", "buyer_area", "state", "timeline"]

# Only used by the synchronous entry point (no session, e.g. unit tests). The graph node reads the real
# brands table instead, so this list is a fallback and not a second source of truth.
FALLBACK_BRANDS = [
    "Audi",
    "BMW",
    "Chevrolet",
    "Ford",
    "Honda",
    "Hyundai",
    "Kia",
    "Mahindra",
    "Mercedes-Benz",
    "Nissan",
    "Tesla",
    "Toyota",
]

TIMELINES = ["ASAP", "Within 1 week", "Within 2 weeks", "Just exploring"]
BUDGET_RE = re.compile(
    r"(?:under|budget|max|around|about|approximately|up\s+to|~)\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?(?:\s*[kKmM])?)",
    re.IGNORECASE,
)


def _normalize_budget(raw: str) -> str | None:
    """Turn "$45k" / "45,000" / "$1.2M" / "~40000" into plain digits, so the budget is one comparable format."""
    text = re.sub(r"[$,~\s]", "", str(raw))
    multiplier = 1
    for suffix, factor in (("m", 1_000_000), ("k", 1_000)):
        if re.search(rf"{suffix}$", text, re.IGNORECASE):
            multiplier = factor
            text = re.sub(rf"{suffix}$", "", text, flags=re.IGNORECASE)
            break
    try:
        return str(int(float(text) * multiplier))
    except ValueError:
        return None


# "Austin, TX" / "in TX" / "near TX". Codes are matched case-sensitively and only after a comma or a
# preposition, otherwise Indiana ("IN"), Oregon ("OR") and Maine ("ME") match the ordinary words
# "in", "or" and "me".
STATE_CODE_RE = re.compile(r"(?:,\s*|\b(?:in|near|around|from|to)\s+)([A-Z]{2})\b")


class ExtractedRequirements(BaseModel):
    """Structured output contract for the LLM pass. Free-text replies are never trusted directly."""

    model_name: str | None = None
    body_type: str | None = None
    buyer_area: str | None = None
    state: str | None = None
    timeline: str | None = None
    budget_max: str | None = None


async def _reference_data(session: AsyncSession) -> tuple[list[str], list[dict[str, str]]]:
    brands = list(
        (await session.execute(select(Brand.name).where(Brand.is_active.is_(True)).order_by(Brand.name))).scalars()
    )
    rows = (
        await session.execute(select(State.name, State.code).where(State.is_active.is_(True)).order_by(State.name))
    ).all()
    return brands, [{"name": name, "code": code} for name, code in rows]


def _extract_deterministic(text: str, current: dict, brands: list[str], states: list[dict[str, str]]) -> dict:
    """Cheap lexical pass: brand, budget, timeline and any state the buyer spelled out or coded."""
    lowered = text.lower()
    for brand in brands:
        if brand.lower() in lowered:
            current["brand"] = brand
    budget = BUDGET_RE.search(text)
    if budget:
        normalized = _normalize_budget(budget.group(1))
        if normalized:
            current["budget_max"] = normalized
    for timeline in TIMELINES:
        if timeline.lower() in lowered:
            current["timeline"] = timeline
    for state in states:
        if re.search(rf"\b{re.escape(state['name'])}\b", text, re.IGNORECASE) or state["code"] in STATE_CODE_RE.findall(
            text
        ):
            current["state"] = state["name"]
            break
    return current


def _finish(current: dict, step: int) -> dict:
    missing = [field for field in REQUIRED if not current.get(field)]
    questions = []
    if "brand" in missing:
        questions.append(
            {
                "field": "brand",
                "question": "Which brands are you open to?",
                "options": FALLBACK_BRANDS[:6],
                "multiple": True,
            }
        )
    if "model" in missing:
        questions.append(
            {"field": "model", "question": "Do you have a model in mind?", "options": [], "multiple": False}
        )
    if "buyer_area" in missing:
        questions.append(
            {
                "field": "buyer_area",
                "question": "What city and state should dealers search around?",
                "options": [],
                "multiple": False,
            }
        )
    if "timeline" in missing:
        questions.append(
            {"field": "timeline", "question": "When are you hoping to buy?", "options": TIMELINES, "multiple": False}
        )
    return {"requirements": current, "missing_fields": missing, "suggested_questions": questions[:3], "step": step}


def gather_requirements(state: AgentState) -> AgentState:
    """Synchronous, zero-LLM entry point. Kept for direct callers and unit tests."""
    step = log_agent_step("requirements", "gather", state)
    current = _extract_deterministic(state.get("message", ""), dict(state.get("requirements", {})), FALLBACK_BRANDS, [])
    return _finish(current, step)


async def _llm_extract(
    llm: LlmClient,
    state: AgentState,
    current: dict,
    brands: list[str],
    states: list[dict[str, str]],
    missing: list[str],
    prompt_overrides: dict[str, str] | None = None,
    prompt_version: str = "v1",
    agent_profile: dict | None = None,
) -> dict:
    """Semantic pass for what lexical matching cannot do: model names and mapping a city to its state.

    Runs only while REQUIRED fields are still missing, and any failure falls back to the deterministic
    result rather than failing the turn - the requirements card is advisory, not the answer itself."""
    valid_states = {state_row["name"].lower(): state_row["name"] for state_row in states}
    state_lines = ", ".join(f"{row['name']} ({row['code']})" for row in states)
    prompt = (
        f"{load_prompt('requirements.md', prompt_overrides)}\n\n"
        f"ALLOWED BRANDS: {', '.join(brands)}\n"
        f"US STATES AND CODES: {state_lines}\n"
        f"ALREADY CAPTURED (do not repeat): {current}\n"
        f"STILL MISSING: {', '.join(missing)}\n"
        "Reply with ONLY a JSON object using the keys model_name, body_type, buyer_area, state, timeline, "
        "budget_max. Use null for anything the buyer did not say. state must be one of the full state names "
        "listed above, resolved from whatever city or region the buyer mentioned. Do not guess and do not "
        "invent a model the buyer did not name.\n\n"
        f'<buyer_message trust="untrusted">\n{state.get("message", "")}\n</buyer_message>'
    )
    try:
        profile = agent_profile or {}
        result = await llm.generate(
            prompt,
            "requirement_extraction",
            state.get("trace_id") or state.get("thread_id"),
            prompt_version=prompt_version,
            model=profile.get("model"),
            reasoning_effort=profile.get("reasoning_effort"),
            max_output_tokens=profile.get("max_output_tokens"),
        )
        match = re.search(r"\{.*\}", result.text, re.DOTALL)
        extracted = ExtractedRequirements.model_validate_json(match.group(0) if match else result.text)
    except Exception as exc:
        logger.warning("agent_requirement_extraction_failed", thread_id=state.get("thread_id"), error=str(exc)[:200])
        return {}

    values = extracted.model_dump()
    if values.get("state") and valid_states.get(str(values["state"]).lower()):
        values["state"] = valid_states[str(values["state"]).lower()]
    else:
        values["state"] = None
    values["model"] = values.pop("model_name")
    values["budget_max"] = _normalize_budget(str(values["budget_max"])) if values.get("budget_max") else None
    logger.info("agent_requirement_extraction", thread_id=state.get("thread_id"), extracted=values)
    return values


async def gather_requirements_from_message(
    session: AsyncSession,
    state: AgentState,
    prompt_overrides: dict[str, str] | None = None,
    prompt_version: str = "v1",
    agent_profile: dict | None = None,
) -> AgentState:
    """Graph node: deterministic extraction first, then one LLM pass only for what is still missing."""
    step = log_agent_step("requirements", "gather", state)
    text = state.get("message", "")
    current = dict(state.get("requirements", {}))
    try:
        brands, states = await _reference_data(session)
    except Exception as exc:
        logger.warning("agent_requirement_reference_data_failed", error=str(exc)[:200])
        brands, states = FALLBACK_BRANDS, []

    current = _extract_deterministic(text, current, brands, states)
    missing = [field for field in REQUIRED if not current.get(field)]
    if session is not None and missing:
        try:
            enriched = await _llm_extract(
                LlmClient(session),
                state,
                current,
                brands,
                states,
                missing,
                prompt_overrides,
                prompt_version,
                agent_profile,
            )
            for key, value in enriched.items():
                # Never clobber a value the deterministic pass already trusted.
                if value and not current.get(key):
                    current[key] = value
        except Exception as exc:  # pragma: no cover - defensive, _llm_extract already swallows
            logger.warning(
                "agent_requirement_enrichment_failed", thread_id=state.get("thread_id"), error=str(exc)[:200]
            )
    return _finish(current, step)


def build_requirement_graph(
    session: AsyncSession | None = None,
    prompt_overrides: dict[str, str] | None = None,
    prompt_version: str = "v1",
    agent_profiles: dict[str, dict] | None = None,
):
    graph = StateGraph(AgentState)

    async def gather(state: AgentState) -> AgentState:
        return await gather_requirements_from_message(
            session, state, prompt_overrides, prompt_version, (agent_profiles or {}).get("requirements")
        )

    graph.add_node("gather", gather)
    graph.add_edge(START, "gather")
    graph.add_edge("gather", END)
    return graph.compile()
