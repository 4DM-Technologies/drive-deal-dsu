import asyncio
import json
import re
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from html import escape
from time import perf_counter
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

from langgraph.graph import END, START, StateGraph
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.agents.configuration import default_workflow
from src.agents.errors import OrchestratorPlanError
from src.agents.llm import LlmClient
from src.agents.memory import resolve_earlier_reference, summary_text
from src.agents.observability import log_agent_step
from src.agents.prompts import load_fragment, load_prompt
from src.agents.schemas import CarSpecs, OrchestratorPlan
from src.agents.state import AgentState
from src.agents.tools.catalog_tools import (
    MAX_CALLS,
    body_style_hint,
    fallback_plan,
    parse_plan,
    run_catalog_tools,
    shortcut_plan,
)
from src.agents.tools.kb import kb_insert, kb_search
from src.agents.tools.kb_db import write_car
from src.agents.tools.web_search import (
    get_urls,
    has_official_domain,
    process_url,
    search_vehicle_images,
)
from src.database import SessionFactory
from src.repositories.schema import AiTraceSpan, Brand, State
from src.services.catalog.matcher import MatchResult, match_message
from src.settings import get_settings
from src.utils.logger import logger
from src.utils.serialization import model_dict

VALID_ROUTES = ("advice", "compare", "requirements", "off_topic")

# Routes the main model answers on its own, with no planner, no sub-agent and no tool call. The service layer
# uses this to avoid spending a requirements-extraction call on a greeting or an out-of-scope message.
DIRECT_REPLY_ROUTES = frozenset({"small_talk", "off_topic"})

# Greetings, acknowledgements and identity questions. These need no inventory lookup, no web research and
# no planner, so they bypass the classifier/orchestrator/sub-agent pipeline entirely and are answered by the
# main model in one call.
SMALL_TALK_PATTERNS = (
    # A greeting may carry an addressee ("hey serra, how are you", "hi there, good morning") and may be
    # followed by a courtesy phrase. The addressee is at most three words, each after a required separator:
    # an unbounded "(\s*,?\s*[\w'-]+)*" could split one word many ways (catastrophic backtracking on
    # "hi aaaa…#") and also swallowed real questions such as "hi I want a camry".
    r"^\s*(?:hi|hey|hello|yo|sup|howdy|hiya|heya|greetings)\b"
    r"(?:[\s,]+[\w'-]+){0,3}"
    r"(\s*,?\s*(?:how\s+are\s+you|how'?s\s+it\s+going|whats\s+up|what'?s\s+up|you\s+ok"
    r"|good\s+(?:morning|afternoon|evening|night)))?"
    r"[\s!.?]*$",
    r"^\s*(hi|hey|hello|yo|sup|howdy|hiya|heya|greetings)\s*(there|everyone|all|friend)?[\s!.?]*$",
    r"^\s*good\s+(morning|afternoon|evening|night|day)[\s!.?]*$",
    r"^\s*(how\s+are\s+you|how'?s\s+it\s+going|whats\s+up|what'?s\s+up|you\s+ok)[\s!.?]*$",
    r"^\s*(thanks|thank\s+you|thx|ty|cheers|appreciate\s+it|nice|cool|great|awesome|perfect|ok|okay|"
    r"got\s+it|sounds\s+good|np|no\s+problem|you'?re\s+welcome)[\s!.?]*$",
    r"^\s*(bye|goodbye|see\s+ya|see\s+you|later|cya)[\s!.?]*$",
    r"^\s*(who\s+are\s+you|what\s+are\s+you|what(?:'s|s|\s+is)\s+your\s+name|"
    r"do\s+you\s+have\s+a\s+name|what\s+can\s+you\s+do|how\s+can\s+you\s+help|help)[\s!.?]*$",
    r"^\s*(yes|yeah|yep|yup|no|nope|nah|sure|maybe|perhaps)[\s!.?]*$",
    # Courtesy/praise replies. The sentiment word is allowlisted so statements like "that is my final
    # offer" are not mistaken for chit-chat.
    r"^\s*(that'?s|thats|that\s+is|this\s+is|it'?s)\s+(great|good|nice|awesome|cool|perfect|helpful|"
    r"clear|understood|noted|fine)[\s\w]*$",
    r"^\s*i\s+(really\s+)?(appreciate|love|like|understand)\s+(it|that|this|you)[\s!.?]*$",
)

# Terms that mean the message actually has vehicle/inventory content worth retrieving for.
DOMAIN_TERMS = (
    "car",
    "cars",
    "vehicle",
    "vehicles",
    "truck",
    "trucks",
    "suv",
    "sedan",
    "hatchback",
    "coupe",
    "van",
    "auto",
    "automobile",
    "motor",
    "diesel",
    "hybrid",
    "electric",
    "ev",
    "evs",
    "toyota",
    "honda",
    "ford",
    "chevrolet",
    "chevy",
    "bmw",
    "mercedes",
    "audi",
    "tesla",
    "hyundai",
    "kia",
    "nissan",
    "mazda",
    "subaru",
    "volkswagen",
    "vw",
    "jeep",
    "dodge",
    "ram",
    "ford",
    "gmc",
    "cadillac",
    "lexus",
    "acura",
    "infiniti",
    "honda",
    "rivian",
    "lucid",
    "porsche",
    "lexus",
    "mitsubishi",
    "genesis",
    "land rover",
    "range rover",
    "price",
    "prices",
    "pricing",
    "cost",
    "costs",
    "budget",
    "afford",
    "cheap",
    "cheapest",
    "msrp",
    "quote",
    "quotes",
    "offer",
    "offers",
    "deal",
    "deals",
    "discount",
    "payment",
    "monthly",
    "finance",
    "financing",
    "loan",
    "apr",
    "down",
    "payment",
    "trade",
    "trade-in",
    "value",
    "worth",
    "mileage",
    "miles",
    "km",
    "year",
    "years",
    "model",
    "models",
    "make",
    "brand",
    "brands",
    "trim",
    "engine",
    "hp",
    "horsepower",
    "transmission",
    "drivetrain",
    "awd",
    "fwd",
    "rwd",
    "4wd",
    "seats",
    "seating",
    "capacity",
    "body",
    "color",
    "colour",
    "miles",
    "range",
    "battery",
    "charge",
    "charging",
    "mpg",
    "towing",
    "cargo",
    "feature",
    "features",
    "option",
    "options",
    "package",
    "packages",
    "warranty",
    "insurance",
    "tax",
    "dealer",
    "dealers",
    "showroom",
    r"test\s+drive",
    "inventory",
    "listing",
    "listings",
    "stock",
    "compare",
    "versus",
    "vs",
    "better",
    "best",
    "cheapest",
    "recommend",
    "recommendation",
    r"should\s+i",
    r"worth\s+it",
    "reliable",
    "reliability",
    "maintenance",
    "resale",
    "depreciation",
    "ownership",
    r"total\s+cost",
    "out-the-door",
    r"out\s+of\s+the\s+door",
    "odometer",
    "accident",
    "history",
)

SMALL_TALK_RE = re.compile("|".join(SMALL_TALK_PATTERNS), re.IGNORECASE)
# The trailing `s?` lets a single term match its plural ("SUV" / "SUVs", "car" / "cars").
DOMAIN_TERM_RE = re.compile(r"\b(" + "|".join(DOMAIN_TERMS) + r")s?\b", re.IGNORECASE)
MODEL_TERM_RE = re.compile(
    r"\b(?:seltos|creta|x3|i7|civic|accord|camry|corolla|mustang|model\s+[3sxyl])\b", re.IGNORECASE
)

# Attempts to override the advisor's instructions or make it adopt another persona. These are answered by the
# main model straight away so no sub-agent, tool or planner is spent on them.
PROMPT_INJECTION_RE = re.compile(
    r"\b(ignore|disregard|forget|override|bypass)\b[^.?!]{0,40}?\b(previous|prior|above|earlier|all|any|your)?\s*"
    r"(instruction|prompt|rule|directive|guideline|constraint)s?\b"
    r"|\b(reveal|print|show|repeat|output|echo|disclose)\b[^.?!]{0,30}?\b(your|the)\s+(system\s+)?"
    r"(prompt|instruction)s?\b"
    r"|\byou\s+are\s+now\b|\bjailbreak\b|\bdan\s+mode\b|\bdeveloper\s+mode\b|\bpretend\s+(you\s+are|to\s+be)\b"
    r"|\bact\s+as\s+(a|an|if)\b",
    re.IGNORECASE,
)

EXPLICIT_WEB_SEARCH_RE = re.compile(
    r"\b(?:search|browse|look\s+up|find\s+(?:it\s+)?online|check\s+(?:the\s+)?(?:web|internet)|latest|current)\b",
    re.IGNORECASE,
)
EXPLICIT_IMAGE_SEARCH_RE = re.compile(
    r"\b(?:image|images|photo|photos|picture|pictures|gallery|exterior|interior|looks?\s+like|show\s+me)\b",
    re.IGNORECASE,
)
PHOTO_REQUEST_RE = re.compile(r"\b(?:image|images|photo|photos|picture|pictures|pics|gallery)\b", re.IGNORECASE)
SPORTS_CAR_RECOMMENDATION_RE = re.compile(
    r"\bsports?\s+cars?\b.*\b(?:top|good|best|recommend|companies|company|brands?|automakers?|manufacturers?)\b|"
    r"\b(?:top|good|best|recommend)\b.*\bsports?\s+cars?\b",
    re.IGNORECASE,
)
VEHICLE_IMAGE_CONTEXT_RE = re.compile(
    r"\b(?:car|cars|vehicle|vehicles|suv|sedan|hatchback|coupe|kia|seltos|bmw|audi|honda|toyota|ford|tesla|"
    r"hyundai|mercedes|volkswagen|x3|i7|creta|model\s+[3sxyl])\b",
    re.IGNORECASE,
)


def _is_prompt_injection(message: str) -> bool:
    return bool(PROMPT_INJECTION_RE.search(message))


def is_explicit_web_search(message: str) -> bool:
    """True for an explicit live-research request that is also within the vehicle domain."""
    return bool(EXPLICIT_WEB_SEARCH_RE.search(message)) and _has_domain_content(message)


RANKING_RE = re.compile(
    r"\b(top\s*(?:\d{1,2}|three|five|ten|twenty)|rank(?:ing|ings|ed)?|most popular|best[- ]selling|"
    r"best[- ]rated|highest[- ]rated)\b",
    re.IGNORECASE,
)


def is_ranking_request(message: str) -> bool:
    """True for a ranking about vehicles ("top 10 premium cars"). Rankings come from current reviews and sales,
    which the catalog does not hold, so they go to web research when it is switched on."""
    return bool(RANKING_RE.search(message)) and _has_domain_content(message)


def is_sports_car_recommendation(message: str) -> bool:
    """Route broad sports-car shortlists through one combined text-and-image web search."""
    return bool(SPORTS_CAR_RECOMMENDATION_RE.search(message)) or bool(
        re.fullmatch(r"\s*(?:some\s+)?sports?\s+cars?\s*[.!?]*\s*", message, re.IGNORECASE)
    )


def is_explicit_image_search(message: str) -> bool:
    """True when the buyer is asking to see a real vehicle image, not generate one."""
    return bool(EXPLICIT_IMAGE_SEARCH_RE.search(message)) and bool(VEHICLE_IMAGE_CONTEXT_RE.search(message))


def is_direct_reply(message: str) -> bool:
    """True when triage will answer the message without the classifier, planner, sub-agents or tools.

    Lets the service layer skip the parallel requirements graph before any LLM call is made."""
    return _is_prompt_injection(message) or _is_small_talk(message)


def _is_small_talk(message: str) -> bool:
    """True when the message is a greeting, acknowledgement or meta question needing no tools at all."""
    text = message.strip()
    if not text:
        return False
    return bool(SMALL_TALK_RE.match(text)) and not _has_domain_content(text)


def _has_domain_content(message: str) -> bool:
    """True when the message is about vehicles at all; used to keep explicit web searches in scope."""
    return bool(DOMAIN_TERM_RE.search(message) or MODEL_TERM_RE.search(message))


def _hint_summary(hints: MatchResult, message: str) -> dict:
    """What the catalog matcher recognised in the buyer's message, passed to the tool planner as hints."""
    summary: dict = {}
    if hints.make:
        summary["make"] = hints.make.name
    if hints.model:
        summary["model"] = hints.model.name
    if hints.candidates:
        summary["vehicles_named"] = [
            f"{make.name} {model.name}" if model else make.name for make, model in hints.candidates
        ]
    if hints.model_year:
        summary["model_year"] = hints.model_year
    if body := body_style_hint(message):
        summary["body_style"] = body
    summary.update(hints.filters)
    return summary


def _normalize_route(raw: str) -> str:
    """The classifier is a free-text LLM call, so its reply is coerced into exactly one valid route.

    Without this an unconstrained reply such as "none of the above - it's a greeting." becomes the route,
    which then forces an orchestrator call just to recover."""
    match = re.search(r"\b(" + "|".join(VALID_ROUTES) + r")\b", raw.strip().lower())
    return match.group(1) if match else "advice"


def _vehicle_names_from_shortlist(text: str) -> list[str]:
    """Read vehicle names from numbered or bold-bulleted recommendation headings without guessing from prose.

    A bullet counts only when it starts with a bold name ("- **Chevrolet Trax** — ..."), so request summaries such
    as "- **Vehicle:** 2027 Nissan Kicks" are not read as a shortlist.
    """
    names: list[str] = []
    for line in text.splitlines():
        match = re.match(r"\s*\d{1,2}[.)]\s*(.+?)\s*$", line) or re.match(r"\s*[-*•]\s+(\*\*[^*:]+\*\*.*?)\s*$", line)
        if not match:
            continue
        name = re.sub(r"[*_`#]", "", match.group(1)).strip()
        name = re.split(r"\s+[—–|:]\s+", name, maxsplit=1)[0].strip()
        if len(name.split()) < 2 or len(name) > 90:
            continue
        if name.casefold() not in {item.casefold() for item in names}:
            names.append(name)
    return names[:8]


def _shortlist_from_context(context: list[dict[str, str]]) -> list[str]:
    """Use the latest assistant recommendation as the source of truth for follow-up image requests."""
    for item in reversed(context):
        if item.get("role") != "assistant":
            continue
        names = _vehicle_names_from_shortlist(str(item.get("body") or ""))
        if len(names) >= 2:
            return names
    return []


def _previously_found_image_names(context: list[dict[str, Any]], vehicle_names: list[str]) -> list[str]:
    """Recover image matches from persisted media, with a text fallback for older checkpoints."""
    for item in reversed(context):
        if item.get("role") != "assistant":
            continue
        media = item.get("media")
        if isinstance(media, list):
            found = [
                str(image.get("vehicle_name"))
                for image in media
                if isinstance(image, dict) and image.get("vehicle_name")
            ]
            if found:
                return [name for name in vehicle_names if any(name.casefold() == value.casefold() for value in found)]
        body = str(item.get("body") or "")
        match = re.search(
            r"found (?:a matching photo|images?) for\s+(.+?)(?:\.|\s+I(?:['’]m| am) still missing|$)",
            body,
            re.IGNORECASE,
        )
        if match:
            segment = match.group(1).casefold()
            return [name for name in vehicle_names if name.casefold() in segment]
    return []


def is_contextual_image_followup(message: str, context: list[dict[str, Any]]) -> bool:
    """Recognize short image follow-ups when the chat already contains a numbered vehicle shortlist."""
    return bool(EXPLICIT_IMAGE_SEARCH_RE.search(message) and _shortlist_from_context(context))


PRICE_VALUE_RE = re.compile(
    r"\b(?:price|prices|priced|pricing|msrp|cost|costs|value|budget|afford|affordable|cheap|cheaper|cheapest"
    r"|expensive|pricier|priciest)\b"
    r"|\$\s*\d|\b\d+(?:\.\d+)?\s*k\b",
    re.IGNORECASE,
)

RECOMMENDATION_RE = re.compile(
    r"\b(?:recommend\w*|suggest\w*|should\s+i\s+(?:buy|get|choose|pick)|(?:best|good|top)\s+(?:\w+\s+){0,2}"
    r"(?:car|cars|suv|suvs|sedan|sedans|truck|trucks|ev|evs|hybrid|hybrids|minivan|vehicle|vehicles|options?))\b",
    re.IGNORECASE,
)

SHORTLIST_REFERENCE_RE = re.compile(
    r"\b(?:these|those|them|each|all|every|both|shortlist|list|remaining|rest|other|others|missing)\b",
    re.IGNORECASE,
)


def _names_vehicle(message: str, name: str) -> bool:
    """Whether the message names this shortlist vehicle by its model ("the Trax" for "Chevrolet Trax")."""
    words = name.split()
    model = " ".join(words[1:]) if len(words) > 1 else name
    return bool(re.search(rf"\b{re.escape(model)}\b", message, re.IGNORECASE))


ORDINALS = {
    "first": 0, "1st": 0, "#1": 0, "second": 1, "2nd": 1, "#2": 1, "third": 2, "3rd": 2, "#3": 2,
    "fourth": 3, "4th": 3, "#4": 3, "fifth": 4, "5th": 4, "#5": 4, "last": -1, "final": -1,
}  # fmt: skip
_ORDINAL = r"(first|1st|#1|second|2nd|#2|third|3rd|#3|fourth|4th|#4|fifth|5th|#5|last|final)"
# "the second one", "#2", "the 1st and 3rd" - but not "my first car" or "first, tell me".
ORDINAL_RE = re.compile(
    rf"(?:\bthe\s+|(?<!\w)(?=#)){_ORDINAL}(?:\s+(?:and|or|&)\s+(?:the\s+)?{_ORDINAL})?(?!\w)"
    r"(?=\s+(?:one|car|model|option|pick|vehicle|suv)s?\b|\s*$|\s*[.?!,]|\s+(?:please|instead|then)\b)",
    re.IGNORECASE,
)


def _is_bare_photo_request(message: str) -> bool:
    """Plural photos that name no vehicle of their own ("with the images give me", "show photos")."""
    return bool(
        re.search(r"\b(?:photos|pictures|images|pics)\b", message, re.IGNORECASE)
        and not re.search(r"\b(?:of|for)\s+(?:a|an|the)?\s*[a-z]", message, re.IGNORECASE)
    )


def shortlist_targets(message: str, shortlist: list[str]) -> list[str]:
    """The shortlist vehicles a follow-up is about.

    Vehicles the message names win; otherwise a reference to the list ("these", "each", "the shortlist") means all
    of them. A message naming a different car gets none, so it is not treated as a follow-up for the list.
    """
    if not shortlist:
        return []
    named = [name for name in shortlist if _names_vehicle(message, name)]
    if named:
        return named
    positions = [ORDINALS[word.casefold()] for pair in ORDINAL_RE.findall(message) for word in pair if word]
    ordinals = [shortlist[position] for position in positions if position < len(shortlist)]
    if ordinals:
        # "the second one", "#3", "the last one": the position in Sera's list.
        return list(dict.fromkeys(ordinals))
    return list(shortlist) if SHORTLIST_REFERENCE_RE.search(message) else []


# Words that only make sense with the earlier conversation ("prices of these cars", "the two", "that one").
REFERENCE_RE = re.compile(
    r"\b(?:these|those|them|they|it|its|both|either|the\s+two|the\s+(?:first|second|third|last|other)\s+one"
    r"|that\s+(?:one|car|model|shortlist)|this\s+(?:one|car|model)|same\s+cars?)\b",
    re.IGNORECASE,
)


def build_web_query(
    message: str,
    *,
    search_query: str = "",
    context: list[dict[str, Any]] | None = None,
    requirements: dict[str, Any] | None = None,
    preference_terms: list[str] | None = None,
    chat_summary: dict[str, Any] | None = None,
) -> str:
    """Build the hosted web-search query, which sees no conversation of its own.

    The orchestrator's standalone ``search_query`` is preferred. Without one (triage and compare skip the
    orchestrator), cars the message points back to are resolved from the chat's memory ("the first car you
    suggested from Hyundai"), or the buyer's last messages and the active vehicle are attached, so "what are the
    prices of these cars?" is never searched on its own.
    """
    parts = [f"Current buyer request: {message}"]
    earlier = resolve_earlier_reference(message, chat_summary)
    if search_query and search_query.casefold() != message.strip().casefold():
        parts.append(f"Meaning: {search_query}")
    elif earlier:
        parts.append(f"Meaning: the {' and '.join(earlier)}")
    elif REFERENCE_RE.search(message):
        recent = [
            str(item.get("body") or "")[:200]
            for item in (context or [])
            if item.get("role") == "user" and item.get("body") and item.get("body") != message
        ][-2:]
        if recent:
            parts.append("Earlier buyer messages: " + " | ".join(recent))
        vehicle = " ".join(
            str(value) for value in ((requirements or {}).get("brand"), (requirements or {}).get("model")) if value
        )
        if vehicle:
            parts.append(f"Vehicle being discussed: {vehicle}")
    return " ".join([*parts, *(preference_terms or [])])


def no_web_evidence_answer(requirements: dict[str, Any] | None = None) -> str:
    """Reply when web search returned nothing citable. The question is not answered from memory."""
    vehicle = " ".join(
        str(value) for value in ((requirements or {}).get("brand"), (requirements or {}).get("model")) if value
    )
    if vehicle:
        return (
            f"I couldn’t find a reliable current source for that about the **{vehicle}** just now. "
            "Want me to try again, or tell me the exact make, model and year to look up?"
        )
    # No car is known from the chat, but the message may have named one ("the Corvette ZR1"), so don't ask for it.
    return "I couldn’t find a reliable current source for that just now. Want me to try again?"


def _label_matching_images(media: list[dict[str, str]], vehicle_names: list[str]) -> list[dict[str, str]]:
    """Match at most one image per vehicle, requiring the full make/model identity as evidence.

    Hostnames and partial model names are deliberately excluded: those weak matches caused unrelated
    search results to be presented as exact trims (and allowed duplicate cars in the photo count).
    """
    labeled: list[dict[str, str]] = []
    matched_names: set[str] = set()
    for image in media:
        # The source hostname is not vehicle evidence (for example, a Nissan fan site can host a
        # discussion containing photos of another make). Search captions and URL paths only.
        source_path = urlparse(image.get("source_url", "")).path
        evidence = re.sub(r"[^a-z0-9]+", " ", f"{image.get('alt', '')} {source_path}".casefold()).strip()
        for name in vehicle_names:
            key = re.sub(r"[^a-z0-9]+", " ", name.casefold()).strip()
            if not key or key in matched_names:
                continue
            identity = re.sub(r"[^a-z0-9]+", " ", name.casefold()).strip()
            if re.search(rf"\b{re.escape(identity)}\b", evidence):
                # Keep the provider caption as useful accessibility text; the canonical shortlist
                # label is a separate field for the UI.
                labeled.append({**image, "vehicle_name": name})
                matched_names.add(key)
                break
    return labeled


def _extract_json(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    return json.loads(match.group(0) if match else text)


def _extract_json_array(text: str) -> list:
    match = re.search(r"\[.*\]", text, re.DOTALL)
    return json.loads(match.group(0) if match else text)


def _trace_snapshot(value: dict | None, *, output: bool = False) -> dict:
    """Keep administrator traces useful without persisting full ORM objects or unbounded payloads."""
    if not value:
        return {}
    allowed = (
        (
            "route",
            "mode",
            "answer",
            "sources",
            "media",
            "catalog_results",
            "tool_plan_source",
            "web_results",
            "car_specs",
            "search_provider",
            "named_model_missing",
        )
        if output
        else (
            "message",
            "route",
            "mode",
            "preferences",
            "preferences_pending",
            "requirements",
            "preference_action",
            "conversation_context",
            "car_names",
            "include_images",
        )
    )
    snapshot: dict = {}
    for key in allowed:
        if key not in value or value[key] is None:
            continue
        raw = json.dumps(value[key], default=str, ensure_ascii=False)
        snapshot[key] = json.loads(raw[:12_000]) if len(raw) <= 12_000 else f"{raw[:12_000]}…"
    return snapshot


# asyncio only holds a weak reference to a task - with nothing else referencing it, a fire-and-forget task can
# be garbage-collected mid-run. Keeping a strong reference here (self-removed on completion) is the standard
# pattern to prevent that silent loss; see https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task
_background_tasks: set[asyncio.Task] = set()


def _fire_and_forget(coro: Awaitable[None]) -> None:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def _persist_cars_background(
    car_specs: list[dict], user_id: str, buyer_state_name: str | None, thread_id: str | None
) -> None:
    """Upserts web-crawled CarSpecs into the `cars` table so kb_agent can serve them next time, without the
    buyer's streamed answer waiting on it. Runs on its own SessionFactory() session rather than the request's
    shared session, since concurrent flushes on one AsyncSession are not safe (see stream_chat's
    requirement_task/requirement_session in ai_service.py for the same pattern) and this task outlives the
    request/response that triggered it."""
    persisted = []
    async with SessionFactory() as bg_session:
        try:
            state_row = None
            if buyer_state_name:
                state_row = (
                    (await bg_session.execute(select(State).where(State.name.ilike(buyer_state_name))))
                    .scalars()
                    .first()
                )
            for spec in car_specs:
                if not spec.get("make") or not spec.get("model") or not spec.get("year") or not spec.get("price_usd"):
                    continue
                brand = (
                    (await bg_session.execute(select(Brand).where(Brand.name.ilike(spec["make"])))).scalars().first()
                )
                if not brand or not state_row:
                    # Without a buyer-stated state, there is no reliable location for this listing - persisting
                    # it under an arbitrary State row would silently corrupt location data, so skip it instead.
                    continue
                result = await write_car(
                    bg_session,
                    created_by=user_id,
                    brand_id=brand.id,
                    state_id=state_row.id,
                    model=spec["model"],
                    model_year=int(spec["year"]),
                    price=float(spec["price_usd"]),
                    body_type=spec.get("trim"),
                    mileage=spec.get("mileage") or 0,
                    fuel=spec.get("fuel_type"),
                    transmission=spec.get("transmission"),
                )
                persisted.append(result)
            await bg_session.commit()
            logger.info("agent_persist_cars", thread_id=thread_id, persisted=persisted)
        except Exception as exc:
            await bg_session.rollback()
            logger.warning("agent_persist_cars_failed", thread_id=thread_id, error=str(exc)[:200])


def main_agent(
    session: AsyncSession,
    compare: bool = False,
    *,
    workflow_definition: dict | None = None,
    prompt_overrides: dict[str, str] | None = None,
    agent_profiles: dict[str, dict] | None = None,
    prompt_version: str = "v1",
    preview: bool = False,
    trace_event_sink: Callable[[dict], Awaitable[None]] | None = None,
):
    """Builds Serra's agent graph:

    START -> triage -+-> small_talk -> END                (greeting/ack: one cheap direct reply)
                    +-> classifier -> orchestrator -+-> kb_agent -+-> compose
                                                      |             +-> (missing prefs) -> compose
                                                      +-> web_search_agent (web_direct) -> persist_cars -> compose
                                                      (kb_agent) -> web_search_agent (web_per_car) -> persist_cars -> compose
    """
    llm = LlmClient(session)
    compose_prompt = load_prompt("compose.md", prompt_overrides)
    small_talk_prompt = load_fragment("small_talk.md", prompt_overrides)
    classifier_prompt = load_fragment("classifier.md", prompt_overrides)
    compare_prompt = load_fragment("compare.md", prompt_overrides)
    workflow = workflow_definition or default_workflow()
    configured_edges = workflow.get("edges", [])
    profiles = agent_profiles or {}

    def profile_kwargs(key: str, reasoning_effort: str | None = None) -> dict:
        profile = profiles.get(key, {})
        return {
            "model": profile.get("model"),
            "reasoning_effort": reasoning_effort or profile.get("reasoning_effort"),
            "max_output_tokens": profile.get("max_output_tokens"),
        }

    def conversation_block(state: AgentState) -> str:
        """The chat's memory (whole chat, summarised) and its recent turns (word for word) for a node's prompt."""
        memory = summary_text(state.get("chat_summary"))
        context = state.get("conversation_context") or []
        block = (
            '<chat_memory trust="untrusted">\nWhat this buyer has said and what Sera suggested across the whole '
            f"chat (older turns are not repeated below):\n{memory}\n</chat_memory>\n\n"
            if memory
            else ""
        )
        if context:
            block += (
                '<conversation_context trust="untrusted">\n'
                f"{json.dumps(context[-20:], ensure_ascii=False)}\n"
                "</conversation_context>\n\n"
            )
        return block

    def traced_node(name: str, kind: str, handler):
        async def wrapped(state: AgentState) -> AgentState:
            started = perf_counter()
            span_id = str(uuid4())
            trace_id = state.get("trace_id")
            sequence = int(state.get("step", 0) + 1)
            llm_calls_before = llm.call_count
            if trace_id and trace_event_sink:
                try:
                    await trace_event_sink(
                        {
                            "id": span_id,
                            "trace_id": trace_id,
                            "sequence": sequence,
                            "name": name,
                            "kind": kind,
                            "status": "running",
                            "duration_ms": 0,
                            "input_tokens": 0,
                            "output_tokens": 0,
                            "model_name": None,
                            "details": {"input": _trace_snapshot(state), "llm_called": False},
                            "created_at": datetime.now(UTC).isoformat(),
                        }
                    )
                except Exception as exc:
                    logger.warning("agent_trace_event_sink_failed", trace_id=trace_id, error=str(exc)[:200])
            result = None
            status = "error"
            try:
                result = await handler(state)
                status = "success"
            except Exception:
                raise
            finally:
                if trace_id:
                    details = {
                        "input": _trace_snapshot(state),
                        "output": _trace_snapshot(result, output=True),
                        "llm_called": llm.call_count > llm_calls_before,
                    }
                    span = AiTraceSpan(
                        id=span_id,
                        trace_id=trace_id,
                        sequence=int((result or {}).get("step") or sequence),
                        name=name,
                        kind=kind,
                        status=status,
                        duration_ms=int((perf_counter() - started) * 1000),
                        details=details,
                    )
                    session.add(span)
                    await session.flush()
                    if trace_event_sink:
                        try:
                            await trace_event_sink(model_dict(span))
                        except Exception as exc:
                            # Observability must never be allowed to change the workflow result.
                            logger.warning("agent_trace_event_sink_failed", trace_id=trace_id, error=str(exc)[:200])
            return result or {}

        return wrapped

    def configured_target(source: str, condition: str, fallback: str) -> str:
        edge = next(
            (item for item in configured_edges if item.get("source") == source and item.get("condition") == condition),
            None,
        )
        return str(edge.get("target")) if edge else fallback

    async def triage(state: AgentState) -> AgentState:
        """Deterministic, zero-LLM gate. Runs before the classifier so greetings, acknowledgements and
        instruction-override attempts cost nothing and never touch a sub-agent or a tool."""
        message = state["message"]
        if _is_prompt_injection(message):
            logger.info("agent_prompt_injection_blocked", thread_id=state.get("thread_id"))
            return {
                "route": "small_talk",
                "step": log_agent_step("serra", "triage", state, small_talk=True, reason="prompt_injection"),
            }
        if _is_small_talk(message):
            step = log_agent_step("serra", "triage", state, small_talk=True)
            logger.info("agent_small_talk_short_circuit", thread_id=state.get("thread_id"))
            return {"route": "small_talk", "step": step}
        web_enabled = get_settings().ai_enable_web_search
        context = state.get("conversation_context", [])
        if web_enabled and (is_explicit_image_search(message) or is_contextual_image_followup(message, context)):
            step = log_agent_step("serra", "triage", state, web_search=True, image_search=True)
            logger.info("agent_vehicle_image_search_direct", thread_id=state.get("thread_id"))
            return {"route": "web_search", "mode": "web_direct", "include_images": True, "step": step}
        if web_enabled and (
            is_explicit_web_search(message) or is_ranking_request(message) or is_sports_car_recommendation(message)
        ):
            # The buyer explicitly requested current online research. Skip two LLM routing calls and enter the
            # trusted-domain web pipeline directly; compose still turns the evidence into the final answer.
            step = log_agent_step("serra", "triage", state, web_search=True)
            logger.info("agent_web_search_direct", thread_id=state.get("thread_id"))
            include_images = is_ranking_request(message) or is_sports_car_recommendation(message)
            return {"route": "web_search", "mode": "web_direct", "include_images": include_images, "step": step}
        return {"route": None, "step": log_agent_step("serra", "triage", state, small_talk=False)}

    async def small_talk(state: AgentState) -> AgentState:
        step = log_agent_step("serra", "small_talk", state)
        prompt = (
            f"{small_talk_prompt}\n\n{conversation_block(state)}"
            f"ROUTE: {'off_topic' if state.get('route') == 'off_topic' else 'small_talk'}\n"
            f'<buyer_message trust="untrusted">\n{state["message"]}\n</buyer_message>'
        )
        result = await llm.generate(
            prompt,
            "small_talk",
            state.get("trace_id") or state.get("thread_id"),
            prompt_version=prompt_version,
            **profile_kwargs("small_talk", "low"),
        )
        return {"answer": result.text, "step": step}

    async def classify(state: AgentState) -> AgentState:
        step = log_agent_step("serra", "classifier", state, compare=compare)
        if compare:
            return {"route": "compare", "step": step}
        classifier_context = ""
        memory = summary_text(state.get("chat_summary"))
        if memory:
            classifier_context += f'<chat_memory trust="untrusted">\n{escape(memory)}\n</chat_memory>\n\n'
        context = state.get("conversation_context") or []
        if context:
            classifier_context += (
                '<conversation_context trust="untrusted">\n'
                f"{escape(json.dumps(context[-20:], ensure_ascii=False))}\n"
                "</conversation_context>\n\n"
            )
        prompt = (
            f"{classifier_prompt}\n\n"
            f"{classifier_context}"
            f'<buyer_message trust="untrusted">\n{escape(state["message"])}\n</buyer_message>'
        )
        profile_key = "classifier" if "classifier" in profiles else "main_agent"
        result = await llm.generate(
            prompt,
            "classifier",
            state.get("trace_id") or state.get("thread_id"),
            prompt_version=prompt_version,
            **profile_kwargs(profile_key),
        )
        return {"route": _normalize_route(result.text), "step": step}

    async def orchestrate(state: AgentState) -> AgentState:
        step = log_agent_step("serra", "orchestrator", state, route=state.get("route"))
        if state.get("route") == "compare":
            return {"mode": "kb_only", "step": step}

        # Profile preferences are opt-in for each recommendation request. AiService supplies them only
        # after the buyer chooses "Use saved preferences" on the preference card.
        preferences = state.get("preferences") or {}
        prompt = (
            f"{load_prompt('orchestrator.md', prompt_overrides)}\n\n"
            f"{conversation_block(state)}"
            f"ROUTE: {state.get('route')}\n"
            f'<buyer_question trust="untrusted">\n{state["message"]}\n</buyer_question>\n'
            f"BUYER-APPROVED SAVED PREFERENCES: {preferences or 'none'}\n"
            f"CHAT-ONLY PRIORITIES: {state.get('chat_preferences') or 'none'}\n"
            f"PREFERENCES_PENDING: {state.get('preferences_pending', False)}"
        )
        result = await llm.generate(
            prompt,
            "orchestrator",
            state.get("trace_id") or state.get("thread_id"),
            prompt_version=prompt_version,
            **profile_kwargs("orchestrator", "low"),
        )
        try:
            plan = OrchestratorPlan.model_validate(_extract_json(result.text))
        except Exception as exc:
            # A plan cut off by the output limit still names its mode up front ('{"mode":"kb_only","reasoning":"…'),
            # so keep the mode rather than failing the buyer's turn. Anything without a valid mode still fails.
            truncated = re.match(r'\s*\{\s*"mode"\s*:\s*"(kb_only|web_direct|web_per_car)"', result.text or "")
            if not truncated:
                raise OrchestratorPlanError(
                    f"Orchestrator produced an unparsable plan for thread {state.get('thread_id')}: "
                    f"{result.text[:200]!r}"
                ) from exc
            logger.warning("agent_orchestrator_plan_truncated", thread_id=state.get("thread_id"))
            plan = OrchestratorPlan(mode=truncated.group(1))
        logger.info(
            "agent_orchestrator_plan", thread_id=state.get("thread_id"), mode=plan.mode, reasoning=plan.reasoning
        )
        update: AgentState = {
            "mode": plan.mode,
            "search_query": plan.search_query.strip(),
            "preferences": preferences,
            "step": step,
        }
        if plan.mode == "web_direct" and PHOTO_REQUEST_RE.search(state["message"]):
            # Triage only recognises photo requests for a short list of makes; "a picture of Corvette" reaches here.
            update["include_images"] = True
        return update

    async def route_from_classifier(state: AgentState) -> str:
        # An out-of-scope message is answered by the main model directly, so the planner and every sub-agent
        # are skipped for it.
        condition = "off_topic" if state.get("route") == "off_topic" else "default"
        return configured_target("classifier", condition, "small_talk" if condition == "off_topic" else "orchestrator")

    async def route_from_orchestrator(state: AgentState) -> str:
        if state.get("route") == "compare" and compare:
            return configured_target("orchestrator", "compare", "compose")
        if state.get("mode") == "web_direct" and get_settings().ai_enable_web_search:
            return configured_target("orchestrator", "web_direct", "web_search_agent")
        # kb_only, web_per_car, and web_direct while web search is off: answer from the vehicle catalog.
        return configured_target("orchestrator", "default", "kb_agent")

    async def knowledge(state: AgentState) -> AgentState:
        """kb_agent: answers from the vehicle catalog only, through four read-only tools (catalog_tools.py).

        1. The catalog matcher finds named makes, models, years and preferences (no LLM).
        2. A tool plan is built: in code when the buyer names specific models, otherwise by one LLM call that
           returns JSON. An unparsable LLM plan falls back to a plan built from the matcher's hints.
        3. Each call is validated and run against catalog_makes, catalog_models and catalog_variants only.
        """
        step = log_agent_step("serra", "kb_agent", state, mode=state.get("mode"))
        message = state["message"]
        context = state.get("conversation_context", [])
        # "these" right after a two-car comparison means those two cars, so an older list is used only when the
        # buyer says "shortlist"/"list" or it is Sera's latest reply.
        recent_context = context if re.search(r"\b(?:shortlist|list)\b", message, re.IGNORECASE) else context[-2:]
        shortlist = shortlist_targets(message, _shortlist_from_context(recent_context))
        # "The first car you suggested from Hyundai": resolved from the chat's memory, which covers the whole chat.
        earlier = resolve_earlier_reference(message, state.get("chat_summary"))
        if earlier and not compare:
            message = f"{' vs '.join(earlier[:MAX_CALLS])}. {message}"
        elif state.get("route") == "compare" and shortlist and not compare:
            # "Compare the cars in that shortlist": the cars are in Sera's last list, not in the buyer's messages.
            message = f"{' vs '.join(shortlist[:MAX_CALLS])}. {message}"
        elif state.get("route") == "compare" and REFERENCE_RE.search(message):
            # "compare them": the cars are in the buyer's recent messages. Only for a message that points back;
            # gluing them onto every comparison pulled unrelated cars (a Tesla Roadster) into a Hyundai question.
            prior_buyer_messages = [
                item.get("body", "")
                for item in state.get("conversation_context", [])
                if item.get("role") == "user" and item.get("body")
            ][-3:]
            message = " ".join([*prior_buyer_messages, message])
        trace_id = state.get("trace_id") or state.get("thread_id")
        # Only a model named in this message can be "missing": earlier messages are context, not the question.
        named_now = None if message == state["message"] else await match_message(session, state["message"])
        hints = await match_message(session, message)
        named_now = named_now or hints
        if named_now.make and named_now.unknown_model and not compare and get_settings().ai_enable_web_search:
            # The buyer named a model the catalog does not have under that brand ("Tesla Roadster"). Answering from
            # the catalog would describe a different car, so look the named car up online instead.
            named = f"{named_now.make.name} {named_now.unknown_model.title()}"
            logger.info("agent_catalog_model_missing", thread_id=state.get("thread_id"), vehicle=named)
            return {
                "mode": "web_direct",
                "named_model_missing": named,
                "kb_searched": True,
                "kb_results_relevant": False,
                "step": step,
            }
        plan = shortcut_plan(message, hints)
        plan_source = "shortcut"
        if plan is None:
            prompt = (
                f"{load_prompt('kb_agent.md', prompt_overrides)}\n\n{conversation_block(state)}"
                f"ORCHESTRATOR MODE: {state.get('mode') or 'kb_only'}\n"
                f"CATALOG HINTS: {json.dumps(_hint_summary(hints, message))}\n"
                f'<buyer_question trust="untrusted">\n{message}\n</buyer_question>'
            )
            result = await llm.generate(
                prompt,
                "catalog_tool_plan",
                trace_id,
                prompt_version=prompt_version,
                **profile_kwargs("kb_agent", "low"),
            )
            try:
                plan = parse_plan(result.text)
                plan_source = "llm"
            except ValueError as exc:
                logger.warning("agent_catalog_plan_unparsable", thread_id=state.get("thread_id"), error=str(exc)[:200])
                plan = fallback_plan(message, hints)
                plan_source = "fallback"
        results = await run_catalog_tools(session, plan)
        if state.get("trace_id"):
            for item in results:
                session.add(
                    AiTraceSpan(
                        trace_id=state["trace_id"],
                        sequence=0,
                        name=f"catalog.{item.tool}",
                        kind="tool",
                        status="error" if item.error else "success",
                        duration_ms=item.duration_ms,
                        details={
                            "input": item.args,
                            "output": {"row_count": len(item.rows), "rows": item.rows[:5]},
                            "error": item.error,
                            "plan_source": plan_source,
                            "llm_called": False,
                        },
                    )
                )
        update: AgentState = {
            "catalog_results": [item.as_evidence() for item in results],
            "tool_plan_source": plan_source,
            "kb_searched": bool(results),
            "kb_results_relevant": any(item.rows for item in results),
            "step": step,
        }
        if state.get("mode") == "web_per_car":
            # One model per make: the lookup returns rows alphabetically, so "SUVs" was six Audis.
            names: list[str] = []
            makes: set[str] = set()
            for item in results:
                for row in item.rows:
                    name = " ".join(str(part) for part in (row.get("make"), row.get("model")) if part)
                    make = str(row.get("make") or "").casefold()
                    if name and name not in names and make not in makes:
                        names.append(name)
                        makes.add(make)
            update["car_names"] = names[:6]
            if names:
                # One web search checks the shortlist against the buyer's request: the candidates come from the US
                # model list, which has no prices, so "under $40k" can only be judged with current pricing.
                update["search_query"] = (
                    f"{state['message']} Candidates to consider: {', '.join(names[:6])}. Use current US starting "
                    "prices, keep only those that fit the request, and replace any that don't with better-fitting "
                    "US models."
                )
        if (
            state.get("route") == "compare"
            and not compare
            and get_settings().ai_enable_web_search
            and PRICE_VALUE_RE.search(state["message"])
        ):
            # The catalog holds no prices, so a price or value comparison also needs one current web search.
            compared = (
                list(
                    dict.fromkeys(
                        " ".join(
                            str(part) for part in (row.get("year_shown"), row.get("make"), row.get("model")) if part
                        )
                        for item in results
                        for row in item.rows
                        if row.get("model")
                    )
                )
                or shortlist[:MAX_CALLS]
            )
            if compared:
                update["mode"] = "web_direct"
                update["search_query"] = f"Current US prices (MSRP) of the {' and '.join(compared)}: {state['message']}"
        return update

    async def after_kb(state: AgentState) -> str:
        web_enabled = get_settings().ai_enable_web_search
        if web_enabled and state.get("named_model_missing"):
            return configured_target("kb_agent", "kb_miss", "web_search_agent")
        if web_enabled and state.get("mode") == "web_per_car" and state.get("car_names"):
            return configured_target("kb_agent", "web_per_car", "web_search_agent")
        if (
            web_enabled
            and state.get("route") == "advice"
            and not state.get("kb_results_relevant")
            and RECOMMENDATION_RE.search(state["message"])
        ):
            # "What SUV should I buy in Austin?" with nothing from the catalog: research it rather than reply that
            # there is no data to recommend from.
            return configured_target("kb_agent", "kb_miss", "web_search_agent")
        if web_enabled and state.get("route") == "compare" and state.get("mode") == "web_direct":
            # A price or value comparison: the catalog supplied the specs, web search supplies current prices.
            return configured_target("kb_agent", "kb_miss", "web_search_agent")
        if (
            web_enabled
            and state.get("route") == "requirements"
            and state.get("kb_searched")
            and not state.get("kb_results_relevant")
        ):
            # A named vehicle the catalog does not have: look it up online, but only when web search is on.
            return configured_target("kb_agent", "kb_miss", "web_search_agent")
        return configured_target("kb_agent", "default", "compose")

    async def search_web(state: AgentState) -> AgentState:
        step = log_agent_step("serra", "web_search_agent", state, mode=state.get("mode"))
        thread_id = state.get("thread_id")
        preferences = state.get("preferences") or {}

        if state.get("mode") == "image_search":
            cached = await kb_search(session, state["message"], limit=2) if compare else []
            media = [
                finding
                for result in cached
                for finding in result.get("findings", [])
                if isinstance(finding, dict) and finding.get("image_url")
            ][:2]
            if not media:
                try:
                    media = await search_vehicle_images(
                        LlmClient(session, timeout_seconds=4), state["message"], thread_id=thread_id, limit=2
                    )
                except Exception as exc:
                    logger.warning("agent_vehicle_image_search_failed", thread_id=thread_id, error=str(exc)[:200])
                    media = []
            sources = [
                {"title": item.get("source_name") or "Vehicle image source", "url": item["source_url"]}
                for item in media
                if item.get("source_url")
            ]
            if compare and media and not (preview or state.get("preview")):
                await kb_insert(session, state["message"], media, state["user_id"])
            return {
                "media": media,
                "sources": sources,
                "answer": (
                    (
                        f"Found {len(media)} reference photo{'' if len(media) == 1 else 's'} "
                        f"from automotive source{'s' if len(media) != 1 else ''}."
                    )
                    if media
                    else "I couldn't find reliable images for that vehicle yet."
                ),
                "direct_web_answer": True,
                "step": step,
            }

        specs: list[CarSpecs] = []
        resolved_sources: dict[str, dict[str, str]] = {}
        candidate_evidence: list[dict[str, str]] = []
        search_provider = "openai_hosted_responses"

        # Keep normal research focused on what the buyer just asked. For an image follow-up, carry
        # forward the exact names from the latest numbered shortlist instead of sending the entire
        # transcript to web search (which was wasting tokens and losing the list in long answers).
        context = state.get("conversation_context", [])
        prior_names = _shortlist_from_context(context)
        # "Show me a picture of Corvette" after a Chevrolet shortlist is about the Corvette alone, not a
        # follow-up for the whole list.
        target_names = shortlist_targets(state["message"], prior_names) or (
            prior_names if _is_bare_photo_request(state["message"]) else []
        )
        is_image_followup = (
            bool(state.get("include_images"))
            and is_contextual_image_followup(state["message"], context)
            and bool(target_names)
        )
        if is_image_followup and re.search(
            r"\b(?:other|remaining|rest|missing|last)\b", state["message"], re.IGNORECASE
        ):
            previously_found = _previously_found_image_names(context, prior_names)
            if previously_found:
                target_names = [
                    name
                    for name in prior_names
                    if name.casefold() not in {value.casefold() for value in previously_found}
                ]
        if is_image_followup and prior_names:
            full_query = (
                f"Find one real, attributable photo for each exact vehicle requested: "
                f"{'; '.join(target_names)}. The buyer asks: {state['message']}. "
                "Return only images whose caption or source page identifies the matching vehicle; "
                "never substitute a similar car."
            )
        else:
            full_query = build_web_query(
                state["message"],
                search_query=state.get("search_query") or "",
                context=context,
                requirements=state.get("requirements"),
                preference_terms=[str(value) for value in preferences.values() if value],
                chat_summary=state.get("chat_summary"),
            )
        trace_id = state.get("trace_id") or thread_id

        async def _crawl_all(cands: list[dict]) -> list[CarSpecs]:
            for candidate in cands:
                candidate_evidence.append(candidate)
                resolved_sources[candidate["url"]] = {
                    "title": candidate.get("title") or candidate.get("source_domain") or "Trusted vehicle source",
                    "url": candidate["url"],
                }
            results = await asyncio.gather(
                *[
                    process_url(
                        llm,
                        candidate["url"],
                        state_trace_id=trace_id,
                        profile=profiles.get("web_search_agent"),
                        prompt_overrides=prompt_overrides,
                    )
                    for candidate in cands
                ]
            )
            return [spec for spec in results if spec]

        try:
            settings = get_settings()
            candidates = await get_urls(
                full_query,
                limit=settings.web_search_max_crawl_sites,
                llm=llm,
                thread_id=trace_id,
                prompt_overrides=prompt_overrides,
                include_images=bool(state.get("include_images")),
                image_queries=target_names if is_image_followup else None,
                image_only=is_image_followup,
            )
            if candidates:
                search_provider = candidates[0].get("search_provider") or search_provider
            hosted_answer = next(
                (candidate.get("hosted_answer") for candidate in candidates if candidate.get("hosted_answer")), None
            )
            if hosted_answer:
                hosted_sources = next(
                    (candidate.get("hosted_sources") for candidate in candidates if candidate.get("hosted_sources")),
                    "[]",
                )
                try:
                    sources = json.loads(hosted_sources)
                except (TypeError, json.JSONDecodeError):
                    sources = []
                hosted_media = next(
                    (candidate.get("hosted_media") for candidate in candidates if candidate.get("hosted_media")),
                    "[]",
                )
                try:
                    media = json.loads(hosted_media)
                except (TypeError, json.JSONDecodeError):
                    media = []
                recommended_names = _vehicle_names_from_shortlist(hosted_answer)
                image_names = target_names if is_image_followup and target_names else recommended_names
                if image_names:
                    media = _label_matching_images(media, image_names)
                if hosted_answer and not (preview or state.get("preview")):
                    if compare:
                        await kb_insert(
                            session,
                            state["message"],
                            [
                                {
                                    "title": source.get("title", "Web source"),
                                    "url": source.get("url", ""),
                                    "content": hosted_answer,
                                }
                                for source in sources
                            ],
                            state["user_id"],
                        )
                if is_image_followup and prior_names:
                    found_names = list(
                        dict.fromkeys(item["vehicle_name"] for item in media if item.get("vehicle_name"))
                    )
                    missing_names = [name for name in target_names if name not in found_names]
                    if found_names:
                        readable_answer = (
                            f"I found a matching photo for **{found_names[0]}**."
                            if len(found_names) == 1
                            else "I found matching photos for:\n\n" + "\n".join(f"- **{name}**" for name in found_names)
                        )
                    else:
                        readable_answer = (
                            f"I couldn’t find reliable photos for **{', '.join(target_names)}** just yet, "
                            "so I haven’t attached unrelated cars."
                        )
                    if missing_names and found_names:
                        readable_answer += (
                            f"\n\nI’m still missing photos for {', '.join(missing_names)}. Want me to try those again?"
                        )
                else:
                    readable_answer = re.sub(r"\[[^\]]*\]\(https?://[^)]+\)|https?://\S+", " ", hosted_answer)
                    readable_answer = re.sub(r"(?m)^\s*!\s*$", "", readable_answer)
                    readable_answer = re.sub(r"\(\s*\)", "", readable_answer)
                    readable_answer = re.sub(r"\n{3,}", "\n\n", readable_answer).strip()
                if sources and len(re.findall(r"\b[\w'-]+\b", readable_answer)) < 5:
                    readable_answer = (
                        "I found relevant vehicle sources, but they didn’t provide enough clear evidence to give "
                        "you a reliable summary. Would you like me to retry with a budget or model year?"
                    )
                return {
                    "answer": readable_answer,
                    "direct_web_answer": True,
                    "sources": sources,
                    "media": media,
                    "web_results": [{"content": hosted_answer, "source": source} for source in sources],
                    "search_provider": search_provider,
                    "step": step,
                }
            crawl_candidates = candidates[: settings.web_search_max_crawl_sites]
            specs = await _crawl_all(crawl_candidates)
            if not specs and crawl_candidates and has_official_domain(full_query):
                # Every candidate from the official-domain-scoped search failed to crawl - retry the open
                # web instead of giving up (same reasoning as _resolve_one's fallback, above).
                fallback_candidates = await get_urls(
                    full_query,
                    limit=settings.web_search_max_crawl_sites,
                    llm=llm,
                    thread_id=trace_id,
                    force_open=True,
                    prompt_overrides=prompt_overrides,
                )
                specs = await _crawl_all(fallback_candidates)
        except Exception as exc:
            # Compose can still give a transparent, useful fallback. A search-provider failure must not tear
            # down the SSE stream and surface a framework traceback to the buyer.
            logger.warning("agent_web_search_failed", thread_id=thread_id, error=str(exc)[:200])

        for spec in specs:
            resolved_sources[spec.source_url] = {"title": spec.model or spec.source_url, "url": spec.source_url}
        sources = list(resolved_sources.values())
        if not specs and not sources and not candidate_evidence and state.get("kb_results_relevant"):
            # A price search for a catalog comparison found nothing: still compose the comparison from the catalog.
            return {"sources": [], "web_results": [], "step": step}
        if not specs and not sources and not candidate_evidence:
            return {
                "answer": no_web_evidence_answer(state.get("requirements")),
                "sources": [],
                "web_results": [],
                "direct_web_answer": True,
                "step": step,
            }
        if compare and specs and not (preview or state.get("preview")):
            await kb_insert(
                session,
                state["message"],
                [{"title": s.model or s.source_url, "url": s.source_url, "content": s.model_dump()} for s in specs],
                state["user_id"],
            )
        structured_specs = [spec.model_dump() for spec in specs]
        return {
            "car_specs": structured_specs,
            "web_results": structured_specs or candidate_evidence,
            "sources": sources,
            "step": step,
        }

    async def persist_cars(state: AgentState) -> AgentState:
        step = log_agent_step("serra", "persist_cars", state, count=len(state.get("car_specs") or []))
        car_specs = state.get("car_specs") or []
        if not (preview or state.get("preview")) and car_specs:
            # Fire-and-forget: the buyer's streamed answer must not wait on this write. Runs on its own
            # session (_persist_cars_background), not `session` above, since that one is still in active use
            # by the rest of this request's graph/stream and concurrent flushes on one AsyncSession aren't
            # safe. A failed or slow write here never surfaces to or delays the compose step that follows.
            buyer_state_name = (state.get("requirements") or {}).get("state")
            _fire_and_forget(
                _persist_cars_background(car_specs, state["user_id"], buyer_state_name, state.get("thread_id"))
            )
        return {"step": step}

    async def compose(state: AgentState) -> AgentState:
        step = log_agent_step("serra", "compose", state)
        if state.get("media") or state.get("direct_web_answer"):
            return {"answer": state.get("answer") or "Here are the vehicle images I found.", "step": step}

        # Only the explicit compare-agent receives selected marketplace offers. A natural-language
        # question such as "compare BMW and Audi" stays in the normal advisor flow and uses gathered
        # vehicle evidence instead of asking the buyer to select saved dealer offers.
        is_compare = compare
        system_prompt = compare_prompt if is_compare else compose_prompt
        catalog_block = f'<catalog_data trust="internal">{json.dumps(state.get("catalog_results") or [], default=str)}</catalog_data>'
        web_block = f'<web_research trust="untrusted">{json.dumps(state.get("car_specs") or state.get("web_results") or [], default=str)}</web_research>'
        source_block = (
            f'<web_sources trust="untrusted">{json.dumps(state.get("sources") or [], default=str)}</web_sources>'
        )
        comparison_block = f'<selected_offers trust="internal">{json.dumps(state.get("comparison_rows") or [], default=str)}</selected_offers>'
        question_block = f'<buyer_question trust="untrusted">{state["message"]}</buyer_question>'
        comparison_guidance = (
            "The buyer is comparing vehicles mentioned in this conversation. Compare only facts present in catalog_data "
            "or web_research, identify the compared vehicles by name, and label unavailable facts (especially price, "
            "availability, colors, and reliability) as not reported. Never ask the buyer to pick a saved dealer offer.\n\n"
            if state.get("route") == "compare" and not compare
            else ""
        )
        prompt = (
            f"{system_prompt}\n\n{comparison_guidance}{conversation_block(state)}{question_block}\n\n"
            f"{comparison_block}\n\n{catalog_block}\n\n{web_block}\n\n{source_block}"
        )
        result = await llm.generate(
            prompt,
            "compare" if is_compare else "advisor",
            state.get("trace_id") or state.get("thread_id"),
            prompt_version=prompt_version,
            **profile_kwargs("compare" if is_compare else "compose"),
        )
        return {"answer": result.text, "step": step}

    async def route_from_triage(state: AgentState) -> str:
        if state.get("route") == "small_talk":
            return configured_target("triage", "small_talk", "small_talk")
        condition = "web_search" if state.get("route") == "web_search" else "default"
        return configured_target("triage", condition, "web_search_agent" if condition == "web_search" else "classifier")

    graph = StateGraph(AgentState)
    graph.add_node("triage", traced_node("triage", "router", triage))
    graph.add_node("small_talk", traced_node("small_talk", "agent", small_talk))
    graph.add_node("classifier", traced_node("classifier", "agent", classify))
    graph.add_node("orchestrator", traced_node("orchestrator", "agent", orchestrate))
    # These nodes coordinate LLM planning/extraction with actual catalog/search tools, so trace them as agents.
    graph.add_node("kb_agent", traced_node("kb_agent", "agent", knowledge))
    graph.add_node("web_search_agent", traced_node("web_search_agent", "agent", search_web))
    graph.add_node("persist_cars", traced_node("persist_cars", "action", persist_cars))
    graph.add_node("compose", traced_node("compose", "agent", compose))

    allowed_targets = {node["id"]: node["id"] for node in workflow.get("nodes", [])}
    allowed_targets["end"] = END
    graph.add_edge(START, configured_target("start", "always", "triage"))
    graph.add_conditional_edges(
        "triage",
        route_from_triage,
        allowed_targets,
    )
    graph.add_edge("small_talk", allowed_targets[configured_target("small_talk", "always", "end")])
    graph.add_conditional_edges("classifier", route_from_classifier, allowed_targets)
    graph.add_conditional_edges("orchestrator", route_from_orchestrator, allowed_targets)
    graph.add_conditional_edges("kb_agent", after_kb, allowed_targets)
    # Keep the executable route aligned with the published workflow shown in admin.
    # persist_cars is also the safe pass-through for media and direct web answers.
    web_search_target = configured_target("web_search_agent", "always", "persist_cars")
    graph.add_edge("web_search_agent", allowed_targets[web_search_target])
    graph.add_edge("persist_cars", allowed_targets[configured_target("persist_cars", "always", "compose")])
    graph.add_edge("compose", allowed_targets[configured_target("compose", "always", "end")])
    return graph.compile()
