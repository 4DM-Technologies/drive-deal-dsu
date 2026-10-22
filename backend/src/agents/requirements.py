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
# Fields describing the vehicle itself. When the buyer settles on a car later in a chat, these are rebuilt for that
# car so an earlier draft's vehicle does not leak into the new request; location and timing are kept.
VEHICLE_FIELDS = (
    "brand",
    "model",
    "model_name",
    "years",
    "year_min",
    "year_max",
    "trim",
    "body_type",
    "fuel_type",
    "drivetrain",
    "transmission",
    "color",
)

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
# "budget 30k", and also "my budget is 30K" / "budget of around $30,000": a few filler words may follow "budget".
BUDGET_RE = re.compile(
    r"(?:under|below|less\s+than|(?:not|no)\s+more\s+than|at\s+most|max(?:imum)?|around|about|approximately"
    r"|up\s+to|~|budget(?:\s+(?:is|of|was|=|around|about|max|maximum|limit|up\s+to)){0,3}\s*:?)"
    r"\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?(?:\s*(?:[kKmM]|grand|thousand)\b)?)",
    re.IGNORECASE,
)
MODEL_YEAR_RE = re.compile(r"\b(20[1-3]\d)\b")


def extract_budget(text: str) -> str | None:
    """The buyer's stated budget as plain digits, or None."""
    match = BUDGET_RE.search(text)
    return _normalize_budget(match.group(1)) if match else None


def _normalize_budget(raw: str) -> str | None:
    """Turn "$45k" / "45,000" / "$1.2M" / "~40000" / "25 grand" into plain digits, so the budget is one comparable
    format. A bare number under 1,000 ("about 2", "under 5") is not a car budget and is ignored."""
    text = re.sub(r"[$,~\s]", "", str(raw))
    multiplier = 1
    for suffix, factor in (("thousand", 1_000), ("grand", 1_000), ("m", 1_000_000), ("k", 1_000)):
        if re.search(rf"{suffix}$", text, re.IGNORECASE):
            multiplier = factor
            text = re.sub(rf"{suffix}$", "", text, flags=re.IGNORECASE)
            break
    try:
        amount = int(float(text) * multiplier)
    except ValueError:
        return None
    return str(amount) if amount >= 1_000 else None


# "Austin, TX" / "in TX" / "near TX". Codes are matched case-sensitively and only after a comma or a
# preposition, otherwise Indiana ("IN"), Oregon ("OR") and Maine ("ME") match the ordinary words
# "in", "or" and "me".
STATE_CODE_RE = re.compile(r"(?:,\s*|\b(?:in|near|around|from|to)\s+)([A-Z]{2})\b")


class ExtractedRequirements(BaseModel):
    """Structured output contract for the LLM pass. Free-text replies are never trusted directly."""

    brand: str | None = None
    model_name: str | None = None
    body_type: str | None = None
    buyer_area: str | None = None
    state: str | None = None
    timeline: str | None = None
    budget_max: str | None = None
    # Optional details a buyer may mention; shown under the request card's "More details".
    budget_min: str | None = None
    trim: str | None = None
    color: str | None = None
    drivetrain: str | None = None
    fuel_type: str | None = None
    transmission: str | None = None
    condition: str | None = None
    paying_with: str | None = None


# Optional request details read straight from the message. Each list is (stored value, pattern), first match wins.
COLORS = (
    "black", "white", "silver", "gray", "grey", "red", "blue", "green", "beige", "brown", "gold", "orange",
    "yellow", "purple",
)  # fmt: skip
# A color word counts when it describes the car ("a red one", "in blue,", "a red Tesla"), not "black interior".
COLOR_RE = re.compile(
    rf"\b((?i:{'|'.join(COLORS)}))\b"
    r"(?=\s+(?i:color|colour|paint|exterior|one|car|suv|sedan|truck|please|pls|or|preferably|ideally)\b"
    r"|\s+[A-Z]|\s*$|[,.!?])"
)
DRIVETRAINS = (
    ("AWD", re.compile(r"\b(?:awd|all[- ]wheel[- ]drive)\b", re.I)),
    ("4WD", re.compile(r"\b(?:4wd|4x4|four[- ]wheel[- ]drive)\b", re.I)),
    ("FWD", re.compile(r"\b(?:fwd|front[- ]wheel[- ]drive)\b", re.I)),
    ("RWD", re.compile(r"\b(?:rwd|rear[- ]wheel[- ]drive)\b", re.I)),
)
FUEL_TYPES = (
    ("Plug-in hybrid", re.compile(r"\b(?:plug[- ]in(?:\s+hybrid)?|phev)\b", re.I)),
    ("Hybrid", re.compile(r"\bhybrid\b", re.I)),
    ("Electric", re.compile(r"\b(?:electric|ev)\b", re.I)),
    ("Diesel", re.compile(r"\bdiesel\b", re.I)),
)
TRANSMISSIONS = (
    ("Manual", re.compile(r"\b(?:manual|stick[- ]shift|stick)\b", re.I)),
    ("Automatic", re.compile(r"\bautomatic\b", re.I)),
)
CONDITIONS = (
    ("Certified pre-owned", re.compile(r"\b(?:certified(?:\s+pre[- ]?owned)?|cpo)\b", re.I)),
    ("Used", re.compile(r"\b(?:used|pre[- ]?owned|second[- ]hand)\b", re.I)),
    ("New", re.compile(r"\b(?:brand[- ]new|(?:a|buy)\s+new\s+(?:one|car|vehicle|suv|truck))\b", re.I)),
)
PAYMENTS = (
    ("Lease", re.compile(r"\b(?:lease|leasing)\b", re.I)),
    ("Finance", re.compile(r"\b(?:financ\w*|loan)\b", re.I)),
    ("Cash", re.compile(r"\b(?:pay(?:ing)?\s+(?:in\s+)?cash|cash\s+(?:buyer|purchase|deal)|all\s+cash)\b", re.I)),
)
BUDGET_RANGE_RE = re.compile(
    r"\b(?:between|from)\s*\$?\s*([0-9][0-9,.]*\s*(?:k|grand|thousand)?)\s*(?:and|to|-)\s*\$?\s*"
    r"([0-9][0-9,.]*\s*(?:k|grand|thousand)?)",
    re.I,
)


def _extract_optional(text: str, current: dict) -> dict:
    """Color, drivetrain, fuel, transmission, condition, payment and a budget range, when the buyer says them."""
    for key, options in (
        ("drivetrain", DRIVETRAINS),
        ("fuel_type", FUEL_TYPES),
        ("transmission", TRANSMISSIONS),
        ("condition", CONDITIONS),
        ("paying_with", PAYMENTS),
    ):
        value = next((label for label, pattern in options if pattern.search(text)), None)
        if value:
            current[key] = value
    color = COLOR_RE.search(text)
    if color:
        current["color"] = "Gray" if color.group(1).lower() == "grey" else color.group(1).capitalize()
    budget_range = BUDGET_RANGE_RE.search(text)
    if budget_range:
        low = _normalize_budget(budget_range.group(1))
        high = _normalize_budget(budget_range.group(2))
        # A range under $5,000 is a year range ("from 2020 to 2023"), not a budget.
        if low and high and 5_000 <= int(low) < int(high):
            current["budget_min"], current["budget_max"] = low, high
    return current


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
    budget = extract_budget(text)
    if budget:
        current["budget_max"] = budget
    year = MODEL_YEAR_RE.search(text)
    if year and not current.get("years"):
        current["years"] = year.group(1)
    for timeline in TIMELINES:
        if timeline.lower() in lowered:
            current["timeline"] = timeline
    for state in states:
        if re.search(rf"\b{re.escape(state['name'])}\b", text, re.IGNORECASE) or state["code"] in STATE_CODE_RE.findall(
            text
        ):
            current["state"] = state["name"]
            break
    return _extract_optional(text, current)


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


def _conversation_block(state: AgentState) -> str:
    """The recent buyer and Sera messages, so a follow-up such as "I'm good with car A" can be resolved."""
    turns = [
        f"{item['role'].upper()}: {str(item['body'])[:600]}"
        for item in state.get("conversation_context") or []
        if isinstance(item, dict) and item.get("role") in {"user", "assistant"} and item.get("body")
    ][-8:]
    from src.agents.memory import summary_text  # memory imports this module's extractors

    memory = summary_text(state.get("chat_summary"))
    block = f'<chat_memory trust="untrusted">\n{memory}\n</chat_memory>\n\n' if memory else ""
    if turns:
        block += '<conversation_context trust="untrusted">\n' + "\n".join(turns) + "\n</conversation_context>\n\n"
    return block


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
    valid_brands = {brand.lower(): brand for brand in brands}
    state_lines = ", ".join(f"{row['name']} ({row['code']})" for row in states)
    selection = (
        "VEHICLE SELECTION: the buyer is settling on one vehicle discussed in the conversation (for example "
        '"I\'m good with the Camry" or "post a request for the second one"). Work out which vehicle they mean '
        "from the conversation and return its brand and model_name.\n"
        if state.get("vehicle_selection")
        else ""
    )
    prompt = (
        f"{load_prompt('requirements.md', prompt_overrides)}\n\n"
        f"ALLOWED BRANDS: {', '.join(brands)}\n"
        f"US STATES AND CODES: {state_lines}\n"
        f"ALREADY CAPTURED (do not repeat): {current}\n"
        f"STILL MISSING: {', '.join(missing)}\n"
        f"{selection}"
        "Reply with ONLY a JSON object using the keys brand, model_name, body_type, buyer_area, state, timeline, "
        "budget_max, budget_min, trim, color, drivetrain, fuel_type, transmission, condition, paying_with. "
        "Use null for anything the buyer did not say. brand must be one of the allowed brands. state "
        "must be one of the full state names listed above, resolved from whatever city or region the buyer "
        "mentioned. Do not guess and do not invent a model the buyer did not name.\n\n"
        f"{_conversation_block(state)}"
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
    values["brand"] = valid_brands.get(str(values.get("brand") or "").lower())
    if values.get("state") and valid_states.get(str(values["state"]).lower()):
        values["state"] = valid_states[str(values["state"]).lower()]
    else:
        values["state"] = None
    values["model"] = values.pop("model_name")
    for key in ("budget_max", "budget_min"):
        values[key] = _normalize_budget(str(values[key])) if values.get(key) else None
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
    selection = bool(state.get("vehicle_selection"))
    if selection:
        current = {key: value for key, value in current.items() if key not in VEHICLE_FIELDS}
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
                # Never clobber a value the deterministic pass already trusted, except the chosen vehicle on a
                # selection turn: the conversation decides which car it is, not a brand word in the message.
                if value and (not current.get(key) or (selection and key in VEHICLE_FIELDS)):
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
