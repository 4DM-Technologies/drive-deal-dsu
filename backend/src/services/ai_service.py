import asyncio
import re
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from time import monotonic, perf_counter
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.agents.llm import LlmClient
from src.agents.memory import (
    apply_soft_memory,
    bootstrap_summary,
    make_of,
    refine_soft_memory,
    update_summary,
    vehicle_names,
)
from src.agents.requirements import build_requirement_graph, extract_budget
from src.agents.serra.graph import (
    DIRECT_REPLY_ROUTES,
    is_contextual_image_followup,
    is_direct_reply,
    is_explicit_image_search,
    is_explicit_web_search,
    is_ranking_request,
    is_sports_car_recommendation,
    main_agent,
)
from src.agents.tools.web_search import search_vehicle_images
from src.database import SessionFactory
from src.models.guided import GuidedStep
from src.models.marketplace import AiChatRequest, AiGuidedCheckpoint, CompareRequest, RequestCreate
from src.repositories.schema import (
    AiTrace,
    AiTraceSpan,
    Brand,
    BuyerRequest,
    ConversationHistory,
    DealQuote,
    LlmAudit,
    Profile,
    State,
)
from src.services.administration_service import AdministrationService
from src.services.billing_service import BillingService
from src.services.catalog.matcher import MatchResult, match_message
from src.services.catalog.planner import GuidedPlanner, opening_message
from src.services.catalog.queries import CatalogQueries
from src.services.marketplace_service import MarketplaceService
from src.services.trace_status import llm_failure
from src.settings import get_settings
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow
from src.utils.logger import logger
from src.utils.serialization import model_dict

_PUBLISH_CONFIRMATION_RE = re.compile(
    r"^\s*(?:yes[, ]*)?(?:please\s+)?(?:post|publish|send)\s+(?:it|this|the\s+(?:request|post)|my\s+(?:request|post))\s*[!.]*$",
    re.IGNORECASE,
)
_VEHICLE_IMAGE_CACHE: dict[str, tuple[float, dict[str, object]]] = {}


def _is_publish_confirmation(message: str) -> bool:
    return bool(_PUBLISH_CONFIRMATION_RE.fullmatch(message))


_MEMORY_TASKS: set[asyncio.Task] = set()


async def _refine_chat_memory(thread_id: str, user_id: str, user_message: str, answer: str) -> None:
    """Background, after the reply: add likes, dislikes, uses and notes to the chat's memory with one small call.

    Runs on its own session. The newest checkpoint is re-read before writing, because the buyer may already have
    sent another message while this call was running; that turn's code-built facts are kept.
    """

    def newest_row():
        return (
            select(ConversationHistory)
            .where(ConversationHistory.thread_id == thread_id, ConversationHistory.user_id == user_id)
            .order_by(ConversationHistory.created_at.desc())
            .limit(1)
        )

    try:
        async with SessionFactory() as session:
            latest = (await session.execute(newest_row())).scalar_one_or_none()
            summary = (latest.checkpoint or {}).get("chat_summary") if latest else None
            if not isinstance(summary, dict):
                return
            soft = await refine_soft_memory(LlmClient(session), summary, user_message, answer)
            if soft is None:
                return
            newest = (await session.execute(newest_row())).scalar_one()
            checkpoint = dict(newest.checkpoint or {})
            checkpoint["chat_summary"] = apply_soft_memory(checkpoint.get("chat_summary") or summary, soft)
            newest.checkpoint = checkpoint
            await session.commit()
    except Exception as exc:  # memory is best effort; the reply was already delivered
        logger.warning("chat_memory_update_failed", thread_id=thread_id, error=str(exc)[:200])


def _first_name(buyer: Any) -> str:
    """The buyer's first name from their account, for a personal reply. Only the first name is ever shared."""
    name = str(getattr(buyer, "first_name", None) or getattr(buyer, "full_name", None) or "").strip()
    return name.split()[0][:40] if name else ""


def _fill_from_memory(requirements: dict, chat_summary: dict | None, message: str = "") -> dict:
    """Request details the buyer gave earlier in the chat, for fields this turn's extraction left empty.

    A model the extraction missed ("go with the Tesla Model Y" -> brand only) is taken from the cars Sera suggested
    when the message names one of them.
    """
    if not isinstance(chat_summary, dict):
        return requirements
    filled = dict(requirements)
    if not (filled.get("model") or filled.get("model_name")):
        for car in reversed(chat_summary.get("cars_suggested") or []):
            name = str(car.get("name") or "")
            make = make_of(name) or ""
            model = name[len(make) :].strip()
            brand_ok = not filled.get("brand") or make.casefold() == str(filled["brand"]).casefold()
            if make and model and brand_ok and model.casefold() in message.casefold():
                filled["brand"] = filled.get("brand") or make
                filled["model"] = model
                break
    buyer = chat_summary.get("buyer")
    if not isinstance(buyer, dict):
        return filled
    for key in (
        "budget_max", "budget_min", "timeline", "color", "drivetrain", "fuel_type", "transmission", "condition",
        "paying_with",
    ):  # fmt: skip
        if not filled.get(key) and buyer.get(key):
            filled[key] = buyer[key]
    location = str(buyer.get("location") or "")
    if location and not filled.get("buyer_area"):
        city, _, state = location.rpartition(", ")
        filled["buyer_area"] = city or location
        if state and city and not filled.get("state"):
            filled["state"] = state
    return filled


def _catalog_year(main_result: dict, requirements: dict) -> str | None:
    """The model year the catalog lookup showed for the chosen car this turn, if it looked that car up."""
    model = str(requirements.get("model") or requirements.get("model_name") or "").casefold()
    if not model:
        return None
    for result in main_result.get("catalog_results") or []:
        for row in result.get("rows") or []:
            if str(row.get("model") or "").casefold() == model and row.get("year_shown"):
                return str(row["year_shown"])
    return None


def _keep_same_car_draft(requirements: dict, request_context: dict | None) -> dict:
    """A new card for the car already on screen keeps what the buyer has filled in (year, city, timing, budget).

    "Show me a picture of Corvette" can be read as settling on the Corvette again; its card must not drop the
    2027 and Las Vegas the buyer already has. A card for a different car starts fresh.
    """
    if not isinstance(request_context, dict) or request_context.get("publishedRequestId"):
        return requirements
    same_car = all(
        str(requirements.get(key) or "").casefold() == str(request_context.get(key) or "").casefold()
        for key in ("brand", "model")
    )
    if not same_car:
        return requirements
    kept = {key: value for key, value in request_context.items() if value not in (None, "")}
    return {**kept, **{key: value for key, value in requirements.items() if value not in (None, "")}}


def _draft_budget_update(message: str, request_context: dict | None) -> dict | None:
    """The request card on screen with a newly stated budget, or None when nothing changes.

    The requirements graph only runs when a buyer settles on a car, so a budget given on an ordinary advice turn
    ("my budget is 30K, which is best?") was never captured on the card.
    """
    if not isinstance(request_context, dict) or not request_context.get("brand"):
        return None
    if request_context.get("publishedRequestId"):
        return None
    budget = extract_budget(message)
    if not budget or budget == str(request_context.get("budget") or ""):
        return None
    return {**request_context, "budget": budget, "budget_max": budget}


def _money_value(value: object) -> Decimal | None:
    if value is None or value == "":
        return None
    text = str(value).strip().lower().replace(",", "")
    match = re.search(r"\d+(?:\.\d+)?", text)
    if not match:
        return None
    amount = Decimal(match.group(0))
    if "k" in text:
        amount *= 1000
    elif "m" in text:
        amount *= 1_000_000
    return amount


RECENT_CONTEXT_ITEMS = 12  # the last six exchanges are kept close to word for word


def _compact_conversation_context(context: list[dict[str, Any]], *, max_chars: int = 6000) -> list[dict[str, Any]]:
    """Fit the loaded turns into ``max_chars`` without losing what an older answer recommended.

    The last six exchanges keep their text (long answers trimmed). Older answers shrink to the cars they named
    ("Suggested: Honda Civic Hybrid, Hyundai Palisade Hybrid, ...") and older questions to a short line. If that is
    still too long, whole messages are dropped from the oldest end. A long answer is never skipped while the
    question before it is kept, which is how an old shortlist used to vanish. The chat summary covers the rest.
    """
    window = context[-20:]
    recent_from = max(0, len(window) - RECENT_CONTEXT_ITEMS)
    items: list[dict[str, Any]] = []
    originals: list[str | None] = []
    for index, original in enumerate(window):
        item = dict(original)
        body = item.get("body")
        originals.append(body if isinstance(body, str) else None)
        if isinstance(body, str):
            if index < recent_from:
                item["body"] = _shorten_old_turn(item.get("role"), body)
            else:
                item["body"] = _clip(body, 2200 if item.get("role") == "assistant" else 700)
        media = item.get("media")
        if isinstance(media, list):
            item["media"] = (
                [
                    {
                        key: str(value)[:500]
                        for key, value in image.items()
                        if key in {"image_url", "source_url", "source_name", "vehicle_name", "alt", "thumbnail_url"}
                    }
                    for image in media[:8]
                    if isinstance(image, dict)
                ]
                if index >= recent_from
                else []
            )
        items.append(item)

    def size() -> int:
        return sum(len(str(item)) for item in items)

    # Over budget: shorten recent turns the same way (oldest first, the last two exchanges stay), then drop.
    for index in range(recent_from, max(recent_from, len(items) - 4)):
        if size() <= max_chars:
            break
        if originals[index] is not None:
            items[index]["body"] = _shorten_old_turn(items[index].get("role"), originals[index])
            items[index].pop("media", None)
    while len(items) > 2 and size() > max_chars:
        items.pop(0)
    # The latest exchange must fit: trim its text from the front if a very long message still overflows.
    while sum(len(str(item)) for item in items) > max_chars and any(isinstance(i.get("body"), str) for i in items):
        longest = max((i for i in items if isinstance(i.get("body"), str)), key=lambda i: len(i["body"]))
        overflow = sum(len(str(item)) for item in items) - max_chars
        if len(longest["body"]) <= 200:
            break
        longest["body"] = longest["body"][: max(200, len(longest["body"]) - overflow - 40)] + " …"
    return items


def _shorten_old_turn(role: str | None, body: str) -> str:
    """An older answer becomes the cars it named; an older question a short line."""
    if role == "assistant":
        names = vehicle_names(body)
        return ("Suggested: " + ", ".join(names)) if names else _clip(body, 300)
    return _clip(body, 200)


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 30] + " … [earlier text omitted]"


class AiService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _live_request_context(self, request_id: str, buyer_id: str) -> dict[str, Any] | None:
        """Load a short, ownership-checked snapshot so follow-ups use live request and offer state."""
        request = await self.session.get(BuyerRequest, request_id)
        if request is None or request.buyer_id != buyer_id:
            return None
        brand = await self.session.get(Brand, request.brand_id)
        offers = (
            await self.session.execute(
                select(DealQuote.status, DealQuote.final_price, DealQuote.created_at)
                .where(DealQuote.buyer_request_id == request.id, DealQuote.buyer_id == buyer_id)
                .order_by(DealQuote.created_at.desc())
                .limit(8)
            )
        ).all()
        return {
            "request_id": request.id,
            "status": request.status,
            "vehicle": " ".join(part for part in (brand.name if brand else "Vehicle", request.model) if part),
            "year_min": request.year_min,
            "year_max": request.year_max,
            "timeline": request.timeline,
            "created_at": request.created_at.isoformat() if request.created_at else None,
            "offers": [
                {
                    "status": status,
                    "total_price": str(price) if price is not None else None,
                    "received_at": created_at.isoformat() if created_at else None,
                }
                for status, price, created_at in offers
            ],
        }

    async def vehicle_images(self, query: str, thread_id: str | None = None) -> dict[str, object]:
        """Find attributed reference images and distinguish a clean miss from a provider outage."""
        settings = get_settings()
        if settings.ai_disabled or not settings.ai_enable_web_search:
            return {"items": [], "status": "unavailable"}
        if not re.search(r"\b(?:model\s+[a-z0-9]+|[a-z][a-z0-9-]{1,})\b", query, re.I):
            return {"items": [], "status": "not_found"}
        cache_key = " ".join(query.casefold().split())
        cached = _VEHICLE_IMAGE_CACHE.get(cache_key)
        if cached and cached[0] > monotonic():
            return {"items": list(cached[1]["items"]), "status": cached[1]["status"]}
        if cached:
            _VEHICLE_IMAGE_CACHE.pop(cache_key, None)
        outcome: dict[str, str] = {}
        items = await search_vehicle_images(
            LlmClient(self.session, timeout_seconds=4), query, thread_id=thread_id, limit=4, outcome=outcome
        )
        status = outcome.get("status", "not_found")
        result: dict[str, object] = {"items": items, "status": status}
        # Image references are public and query-specific. Cache verified hits only: clean misses and
        # provider outages stay eligible for an explicit retry against the live provider.
        if status == "found":
            _VEHICLE_IMAGE_CACHE[cache_key] = (monotonic() + 6 * 60 * 60, result)
        if len(_VEHICLE_IMAGE_CACHE) > 400:
            now = monotonic()
            for key, (expires_at, _) in list(_VEHICLE_IMAGE_CACHE.items()):
                if expires_at <= now:
                    _VEHICLE_IMAGE_CACHE.pop(key, None)
            while len(_VEHICLE_IMAGE_CACHE) > 400:
                _VEHICLE_IMAGE_CACHE.pop(next(iter(_VEHICLE_IMAGE_CACHE)))
        return {"items": list(items), "status": status}

    @log_flow(layer="service")
    async def _publish_saved_requirements(self, requirements: dict, buyer: Profile) -> dict | None:
        """Turn a complete requirement checkpoint into a draft and publish it after explicit confirmation."""
        required = ("brand", "buyer_area", "state", "timeline")
        if any(not requirements.get(field) for field in required):
            return None
        model_name = requirements.get("model") or requirements.get("model_name")
        if not model_name:
            return None
        brand = (
            await self.session.execute(select(Brand).where(Brand.name.ilike(str(requirements["brand"]))))
        ).scalar_one_or_none()
        state = (
            await self.session.execute(select(State).where(State.name.ilike(str(requirements["state"]))))
        ).scalar_one_or_none()
        if brand is None or state is None:
            return None
        years = [int(value) for value in re.findall(r"20\d{2}", str(requirements.get("years") or ""))]
        year_min = years[0] if years else requirements.get("year_min")
        year_max = years[1] if len(years) > 1 else requirements.get("year_max") or year_min
        payload = RequestCreate(
            brand_id=brand.id,
            buyer_area_state_id=state.id,
            model=str(model_name),
            body_type=requirements.get("body_type"),
            year_min=year_min,
            year_max=year_max,
            budget_max=_money_value(requirements.get("budget_max") or requirements.get("budget")),
            buyer_area=str(requirements["buyer_area"]),
            search_radius_miles=int(requirements.get("search_radius_miles") or 50),
            timeline=str(requirements["timeline"]),
            must_haves=list(requirements.get("must_haves") or []),
            request_expire=datetime.now(UTC).replace(microsecond=0) + timedelta(days=30),
            status="draft",
        )
        service = MarketplaceService(self.session)
        draft = await service.create_request(payload, buyer)
        return await service.publish_request(str(draft["id"]), buyer)

    @log_flow(layer="service")
    async def posting_gate(self, buyer: Profile) -> dict:
        """Whether the buyer's plan currently allows turning a Sera preview into a published post."""
        state = await BillingService(self.session).subscription_state(buyer)
        allowed = True if state is None else bool(state.get("can_create_request", True))
        reason = None
        if not allowed:
            reason = "premium_expired" if buyer.is_premium else "request_limit_reached"
        return {
            "posting_allowed": allowed,
            "posting_reason": reason,
            "requests_used": None if state is None else state.get("requests_used"),
            "request_limit": None if state is None else state.get("request_limit"),
        }

    @log_flow(layer="service")
    async def stream_chat(self, payload: AiChatRequest, buyer: Profile):
        thread_id = payload.thread_id or str(uuid4())
        memory = await self._latest_memory(thread_id, buyer.id)
        if payload.preference_action == "update_saved":
            saved_preferences = await self._buyer_preferences(buyer.id)
            card = {"preferences": saved_preferences, "updated": True}
            answer = "Your saved preferences are updated. Would you like me to use them for this recommendation?"
            result = {"route": "preference_choice", "answer": answer}
            yield {"type": "token", "text": answer}
            result["preference_card"] = card
            yield {"type": "card", "kind": "preference", "payload": card}
            await self._save_checkpoint(thread_id, buyer.id, payload, result, {}, memory)
            await self.session.commit()
            yield {"type": "done", "threadId": thread_id, "messagesUsed": 1, "expandedUi": False}
            return
        preference_control = payload.preference_action in {"use_saved", "customize", "skip"}
        continuing_original = preference_control and bool(memory.get("active_request"))
        # Cards (saved preferences, the guided picker and the request draft) belong to the buyer's first question
        # in a chat; every later message gets a plain answer. Greetings do not count as that first question, and a
        # preference-card button continues it.
        first_question = continuing_original or not any(
            item.get("role") == "user" and not is_direct_reply(str(item.get("body") or ""))
            for item in memory.get("conversation_context", [])
        )
        # The saved-preferences card is only offered in a chat started with "Ask Sera a question". The thread's
        # stored entry mode wins over the request's.
        entry_mode = memory.get("entry_mode") or payload.entry_mode
        if (
            payload.agent != "compare-agent"
            and payload.preference_action is None
            and entry_mode == "ask"
            and first_question
            and not memory.get("preference_prompted")
            and not memory.get("active_request")
            and not is_direct_reply(payload.message)
        ):
            yield {"type": "status", "phase": "classifying", "label": "Checking saved preferences"}
            saved_preferences = await self._buyer_preferences(buyer.id)
            if saved_preferences:
                answer = "I found your saved preferences. Should I use them for this request?"
                card = {"preferences": saved_preferences}
                result = {"route": "preference_choice", "answer": answer, "preference_card": card}
                yield {"type": "token", "text": answer}
                yield {"type": "card", "kind": "preference", "payload": card}
                await self._save_checkpoint(thread_id, buyer.id, payload, result, {}, memory)
                await self.session.commit()
                yield {"type": "done", "threadId": thread_id, "messagesUsed": 1, "expandedUi": False}
                return
        if get_settings().ai_disabled:
            demo_payload = (
                payload.model_copy(update={"message": memory.get("active_request") or payload.message})
                if continuing_original
                else payload
            )
            async for event in self._stream_demo(demo_payload, buyer, thread_id, memory):
                yield event
            return
        trace_id = str(uuid4())
        trace_started = perf_counter()
        conversation_context = list(memory.get("conversation_context", []))
        request_context = payload.request_context or memory.get("request_context")
        if request_context:
            conversation_context.append({"request_context": request_context})
        published_request_id = (
            str(request_context.get("publishedRequestId") or "").strip() if isinstance(request_context, dict) else ""
        ) or str(memory.get("published_request_id") or (memory.get("published_request") or {}).get("id") or "").strip()
        if published_request_id:
            live_request = await self._live_request_context(published_request_id, buyer.id)
            if live_request:
                conversation_context.append({"live_request": live_request})
        conversation_context = _compact_conversation_context(conversation_context)
        preference_action = payload.preference_action or memory.get("preference_action")
        preferences = await self._buyer_preferences(buyer.id) if preference_action == "use_saved" else {}
        # A typed user message that dismisses the preference card must still be answered as written.
        # Only the explicit preference buttons should resume the earlier recommendation request.
        active_request = memory.get("active_request") if continuing_original else None
        effective_message = active_request or payload.message
        if payload.preference_action == "skip":
            preference_action = "skip"
            preferences = {}
        chat_preferences = (
            "" if preference_action == "skip" else payload.chat_preferences or memory.get("chat_preferences") or ""
        )
        if chat_preferences:
            effective_message = f"{effective_message}\n\nFor this chat only, also prioritize: {chat_preferences}"
        state = {
            "user_id": buyer.id,
            "thread_id": thread_id,
            "trace_id": trace_id,
            "message": effective_message,
            "requirements": memory.get("requirements", {}),
            "preferences": preferences,
            "preferences_pending": False,
            "preference_action": preference_action,
            "chat_preferences": chat_preferences,
            "conversation_context": conversation_context,
            "chat_summary": memory.get("chat_summary"),
            "buyer_name": _first_name(buyer),
        }
        explicit_web_search = (
            get_settings().ai_enable_web_search
            and (
                is_explicit_web_search(effective_message)
                or is_explicit_image_search(effective_message)
                or is_contextual_image_followup(effective_message, conversation_context)
                or is_ranking_request(effective_message)
                or is_sports_car_recommendation(effective_message)
            )
            and payload.agent != "compare-agent"
        )
        if explicit_web_search:
            yield {"type": "status", "phase": "crawling", "label": "Searching trusted sources"}
        else:
            yield {"type": "status", "phase": "classifying", "label": "Thinking"}
        await asyncio.sleep(0)
        comparison_payload = None
        if payload.agent == "compare-agent" and (payload.request_ids or payload.quote_ids):
            comparison_payload = await self._comparison_payload(payload, buyer)
            state["comparison_rows"] = comparison_payload["rows"]
        runtime = await AdministrationService(self.session).runtime_bundle()
        trace = AiTrace(
            id=trace_id,
            thread_id=thread_id,
            user_id=buyer.id,
            # Preference card callbacks are control events; trace the actual request being answered.
            query=effective_message[:4000],
            status="running",
            is_test=False,
            configuration_version=runtime["version"],
            created_by=buyer.id,
            updated_by=buyer.id,
        )
        self.session.add(trace)
        await self.session.flush()
        if _is_publish_confirmation(payload.message):
            published_request = memory.get("published_request") or await self._publish_saved_requirements(
                state.get("requirements") or {}, buyer
            )
            if published_request is not None:
                main_result = {
                    "route": "requirements",
                    "answer": "Done — your buyer request is now live for verified dealers.",
                    "published_request": published_request,
                }
                yield {"type": "status", "phase": "composing", "label": "Publishing your request"}
                yield {"type": "token", "text": main_result["answer"]}
                yield {"type": "card", "kind": "requestPreview", "payload": published_request}
                await self._finish_trace(trace, main_result, trace_started)
                await self._save_checkpoint(
                    thread_id,
                    buyer.id,
                    payload,
                    main_result,
                    {"requirements": state.get("requirements", {})},
                    memory,
                    trace_id=trace.id,
                )
                await self.session.commit()
                yield {"type": "done", "threadId": thread_id, "messagesUsed": 1, "expandedUi": False}
                return
        # Guided question card. A message naming a catalog vehicle with buying intent ("I want a BMW M3") opens the
        # card. When nothing else was asked, the card is the whole reply: a template sentence and no LLM call.
        guided_step: GuidedStep | None = None
        if payload.agent != "compare-agent" and not explicit_web_search and first_question:
            match = await match_message(self.session, effective_message)
            if match.opens_card and not match.has_question:
                guided_step = await GuidedPlanner(self.session).from_match(match, effective_message)
                reply = await self._guided_reply(match, guided_step) if match.card_only else None
                if reply is not None:
                    main_result = {"route": "guided_card", "answer": reply}
                    yield {"type": "token", "text": reply}
                    if guided_step is not None:
                        yield {"type": "card", "kind": "question", "payload": guided_step.model_dump()}
                    await self._finish_trace(trace, main_result, trace_started)
                    await self._save_checkpoint(
                        thread_id, buyer.id, payload, main_result, {}, memory, trace_id=trace.id
                    )
                    await self.session.commit()
                    yield {"type": "done", "threadId": thread_id, "messagesUsed": 1, "expandedUi": False}
                    return
        main_graph = main_agent(
            self.session,
            compare=payload.agent == "compare-agent",
            workflow_definition=runtime["workflow"],
            prompt_overrides=runtime["prompts"],
            agent_profiles=runtime["agent_profiles"],
            prompt_version=runtime["version"],
        )
        main_task = asyncio.create_task(main_graph.ainvoke(state))
        if payload.agent == "compare-agent":
            main_result = await main_task
            requirement_result = {}
        elif is_direct_reply(effective_message) or explicit_web_search or guided_step is not None or not first_question:
            # Greetings and explicit research requests are handled entirely by the main graph. Neither contains
            # a buyer requirement to extract, so starting the requirements graph would add latency and UI cards.
            # After the first question no request-draft card is shown, so the graph is not started either.
            main_result = await main_task
            requirement_result: dict = {}
        else:
            # The requirements graph runs concurrently with the main graph, so it needs its own AsyncSession:
            # AsyncSession.flush() isn't safe to call from two tasks at once, and both graphs' traced nodes
            # flush on every step, which raised "Session is already flushing" when they shared self.session.
            requirement_session = SessionFactory()
            requirement_task = asyncio.create_task(
                build_requirement_graph(
                    requirement_session,
                    prompt_overrides=runtime["prompts"],
                    prompt_version=runtime["version"],
                    agent_profiles=runtime["agent_profiles"],
                ).ainvoke(state)
            )
            try:
                try:
                    main_result = await main_task
                except BaseException:
                    requirement_task.cancel()
                    raise
                if main_result.get("route") in DIRECT_REPLY_ROUTES:
                    # The classifier ruled the message out of scope, so stop waiting on requirements entirely
                    # rather than letting gather delay the reply until that call finishes.
                    requirement_task.cancel()
                    requirement_result = {}
                else:
                    yield {"type": "status", "phase": "searching", "label": "Searching Deal&Drive knowledge"}
                    requirement_result = await requirement_task
            finally:
                # cancel() only schedules CancelledError at the task's next await point - it does not stop it
                # synchronously. Awaiting it here (whether it finished, was cancelled, or raised) guarantees the
                # task is no longer touching requirement_session before the commit/close below run, which is
                # exactly the race this dedicated session was introduced to avoid.
                requirement_task.cancel()
                with suppress(BaseException):
                    await requirement_task
                if requirement_task.cancelled() or requirement_task.exception():
                    await requirement_session.rollback()
                else:
                    await requirement_session.commit()
                await requirement_session.close()
        if not first_question and payload.agent != "compare-agent" and main_result.get("route") == "requirements":
            # The buyer settled on a car later in the chat ("I'm good with car A"). This is the one card allowed
            # after the first question: an editable request for that car, built from the conversation.
            yield {"type": "status", "phase": "composing", "label": "Preparing your request"}
            requirement_result = await build_requirement_graph(
                self.session,
                prompt_overrides=runtime["prompts"],
                prompt_version=runtime["version"],
                agent_profiles=runtime["agent_profiles"],
            ).ainvoke({**state, "vehicle_selection": True})
            requirement_result["vehicle_selection"] = True
            if not (requirement_result.get("requirements") or {}).get("brand"):
                # The chosen car is not from a brand Deal&Drive dealers sell (the Renault Filante): there is no
                # request to send, and any card would replace the buyer's current draft.
                requirement_result = {}
        if requirement_result.get("requirements"):
            # Budget, color or city given many turns earlier still belong on the card.
            requirement_result["requirements"] = _fill_from_memory(
                requirement_result["requirements"], memory.get("chat_summary"), effective_message
            )
        if requirement_result.get("requirements") and not requirement_result["requirements"].get("years"):
            # "go with the Nissan Kicks" names no year; the catalog lookup this turn says which one was described.
            year = _catalog_year(main_result, requirement_result["requirements"])
            if year:
                requirement_result["requirements"]["years"] = year
        draft_update = (
            None
            if requirement_result or payload.agent == "compare-agent" or main_result.get("route") in DIRECT_REPLY_ROUTES
            else _draft_budget_update(effective_message, payload.request_context)
        )
        if main_result.get("sources") and not explicit_web_search:
            yield {"type": "status", "phase": "crawling", "label": "Searching trusted sources"}
        yield {"type": "status", "phase": "composing", "label": "Preparing response"}
        answer = main_result.get("answer", "I could not prepare an answer from the available evidence.")
        for index in range(0, len(answer), 18):
            yield {"type": "token", "text": answer[index : index + 18]}
            await asyncio.sleep(0)
        if comparison_payload is not None:
            yield {"type": "card", "kind": "compare", "payload": comparison_payload}
        gate = await self.posting_gate(buyer)
        if guided_step is not None and main_result.get("route") not in DIRECT_REPLY_ROUTES:
            yield {"type": "card", "kind": "question", "payload": guided_step.model_dump()}
        elif draft_update:
            # A budget stated later in the chat ("my budget is 30K") updates the request card already on screen.
            yield {
                "type": "card",
                "kind": "requestPreview",
                "payload": {
                    **draft_update,
                    "confirmation_required": True,
                    "posting_allowed": gate["posting_allowed"],
                    "posting_reason": gate["posting_reason"],
                },
            }
        elif requirement_result.get("vehicle_selection") and requirement_result.get("requirements"):
            # Shown even with fields missing: the buyer fills in anything else (such as city) on the card itself.
            yield {
                "type": "card",
                "kind": "requestPreview",
                "payload": {
                    **_keep_same_car_draft(requirement_result["requirements"], payload.request_context),
                    "confirmation_required": True,
                    "posting_allowed": gate["posting_allowed"],
                    "posting_reason": gate["posting_reason"],
                },
            }
        elif not requirement_result.get("missing_fields") and requirement_result.get("requirements"):
            yield {
                "type": "card",
                "kind": "requestPreview",
                "payload": {
                    **requirement_result["requirements"],
                    "confirmation_required": True,
                    "posting_allowed": gate["posting_allowed"],
                    "posting_reason": gate["posting_reason"],
                },
            }
        elif requirement_result.get("suggested_questions"):
            yield {
                "type": "card",
                "kind": "requestPreview",
                "payload": {
                    "questions": requirement_result["suggested_questions"],
                    "draft": requirement_result.get("requirements", {}),
                    "posting_allowed": gate["posting_allowed"],
                    "posting_reason": gate["posting_reason"],
                },
            }
        if main_result.get("sources"):
            yield {"type": "sources", "items": main_result["sources"]}
        if main_result.get("media"):
            yield {"type": "media", "items": main_result["media"]}
        await self._finish_trace(trace, main_result, trace_started)
        await self._save_checkpoint(
            thread_id, buyer.id, payload, main_result, requirement_result, memory, trace_id=trace.id
        )
        await self.session.commit()
        if main_result.get("route") not in DIRECT_REPLY_ROUTES and payload.agent != "compare-agent":
            # After the reply is saved, so the buyer never waits for it.
            self._schedule_memory_refine(thread_id, buyer.id, payload.message, answer)
        yield {"type": "done", "threadId": thread_id, "messagesUsed": 1, "expandedUi": False}

    def _schedule_memory_refine(self, thread_id: str, user_id: str, user_message: str, answer: str) -> None:
        task = asyncio.create_task(_refine_chat_memory(thread_id, user_id, user_message, answer))
        _MEMORY_TASKS.add(task)
        task.add_done_callback(_MEMORY_TASKS.discard)

    async def _guided_reply(self, match: MatchResult, step: GuidedStep | None) -> str | None:
        """Sera's one sentence alongside the card, or a clear reply for a brand outside the dealer network."""
        if step is None:
            if match.make and not match.make.linked:
                return (
                    f"{match.make.name} isn’t in our dealer network yet, so I can’t send a request for it. "
                    f"I can still answer questions about {match.make.name} models."
                )
            return None
        catalog = CatalogQueries(self.session)
        make = await catalog.make(step.answers.make_slug)
        model = await catalog.model(step.answers.make_slug, step.answers.model_slug)
        model_count = len(await catalog.models(make.slug)) if make else 0
        return opening_message(step, make, model_count, model)

    @log_flow(layer="service")
    async def _stream_demo(self, payload: AiChatRequest, buyer: Profile, thread_id: str, memory: dict | None = None):
        """Stream a deterministic product demo without invoking any agent workflow."""
        memory = memory or {}
        phases = [
            ("classifying", "Thinking"),
            ("searching", "Searching Deal&Drive knowledge"),
            ("composing", "Preparing response"),
        ]
        for phase, label in phases:
            yield {"type": "status", "phase": phase, "label": label}
            await asyncio.sleep(0.12)
        lower = payload.message.lower()
        if payload.agent == "compare-agent" and (payload.request_ids or payload.quote_ids):
            comparison = await self._comparison_payload(payload, buyer)
            answer = "## Best value first\nThe leading offer has the lowest complete out-the-door total among your selected requests.\n## Check before accepting\n- Confirm the exact trim and installed equipment\n- Verify delivery timing and every dealer fee\n- Open the top two offers if you want to negotiate\n## My take\nUse price as the starting point, then choose the offer with the fewest unanswered details."
            card = {"type": "card", "kind": "compare", "payload": comparison}
        elif "request" in lower or "car" in lower or "buy" in lower:
            answer = "## Good start — I captured the essentials\nYour dealer brief now has the vehicle, search area, timing, and must-have equipment.\n## One useful next step\nTell me your preferred trim or color, and anything you will not compromise on.\nYou can edit the preview below. It stays private until you choose to post it."
            gate = await self.posting_gate(buyer)
            card = {
                "type": "card",
                "kind": "requestPreview",
                "payload": {
                    "brand": "Ford",
                    "model": "Bronco",
                    "years": "2024–2026",
                    "budget": "$65,000–$72,000 OTD",
                    "area": "Austin, TX · 75 miles",
                    "timeline": "Within 2 weeks",
                    "mustHaves": "4WD, hard top, adaptive cruise",
                    "posting_allowed": gate["posting_allowed"],
                    "posting_reason": gate["posting_reason"],
                },
            }
        else:
            answer = "## Let’s make this decision easier\nTell me what you care about most: daily comfort, family space, performance, running cost, or the lowest possible price.\n## I can help with\n- A focused vehicle shortlist\n- Side-by-side dealer quote comparisons\n- Questions worth asking before you accept\n- An editable request you approve before posting"
            card = None
        for index in range(0, len(answer), 14):
            yield {"type": "token", "text": answer[index : index + 14]}
            await asyncio.sleep(0.025)
        if card:
            yield card
        await self._save_checkpoint(thread_id, buyer.id, payload, {"answer": answer}, {"requirements": {}})
        await self.session.commit()
        yield {"type": "done", "threadId": thread_id, "messagesUsed": 1, "expandedUi": False}

    @log_flow(layer="service")
    async def compare(self, payload: CompareRequest, buyer: Profile) -> dict:
        comparison = await self._comparison_payload(payload, buyer)
        request_ids = comparison["requestIds"]
        rows = comparison["rows"]
        state = {
            "user_id": buyer.id,
            "thread_id": str(uuid4()),
            "trace_id": str(uuid4()),
            "message": "Compare the selected dealer offers and recommend the strongest option.",
            "comparison_rows": rows,
        }
        runtime = await AdministrationService(self.session).runtime_bundle()
        trace_started = perf_counter()
        trace = AiTrace(
            id=state["trace_id"],
            thread_id=state["thread_id"],
            user_id=buyer.id,
            query=state["message"],
            status="running",
            is_test=False,
            configuration_version=runtime["version"],
            created_by=buyer.id,
            updated_by=buyer.id,
        )
        self.session.add(trace)
        await self.session.flush()
        result = await main_agent(
            self.session,
            compare=True,
            workflow_definition=runtime["workflow"],
            prompt_overrides=runtime["prompts"],
            agent_profiles=runtime["agent_profiles"],
            prompt_version=runtime["version"],
        ).ainvoke(state)
        await self._finish_trace(trace, result, trace_started)
        await self.session.commit()
        return {
            "request_ids": request_ids,
            "quote_ids": comparison.get("quoteIds", []),
            "rows": rows,
            "recommendation": result.get("answer"),
            "not_reported_policy": "Fields not supplied by a dealer are never inferred.",
        }

    async def _finish_trace(self, trace: AiTrace, result: dict, started: float) -> None:
        usage = (
            await self.session.execute(
                select(
                    func.coalesce(func.sum(LlmAudit.input_tokens), 0),
                    func.coalesce(func.sum(LlmAudit.output_tokens), 0),
                ).where(LlmAudit.thread_id == trace.id)
            )
        ).one()
        models = (
            await self.session.execute(
                select(LlmAudit.model_name).where(LlmAudit.thread_id == trace.id).order_by(LlmAudit.id.desc()).limit(1)
            )
        ).scalar_one_or_none()
        spans = (
            await self.session.execute(
                select(AiTraceSpan.kind, AiTraceSpan.status, AiTraceSpan.name, AiTraceSpan.details)
                .where(AiTraceSpan.trace_id == trace.id)
                .order_by(AiTraceSpan.sequence, AiTraceSpan.created_at)
            )
        ).mappings()
        # A model call that errored (rate limit, auth, outage) fails the trace, even though a fallback reply was sent.
        failure = llm_failure(spans)
        trace.status = "failed" if failure else "success"
        trace.error_message = failure
        trace.route = result.get("route")
        trace.model_name = models
        trace.input_tokens = int(usage[0] or 0)
        trace.output_tokens = int(usage[1] or 0)
        trace.duration_ms = int((perf_counter() - started) * 1000)
        trace.updated_by = trace.user_id or "system"

    @log_flow(layer="service")
    async def list_threads(self, buyer: Profile) -> list[dict]:
        rows = (
            await self.session.execute(
                select(ConversationHistory)
                .where(
                    ConversationHistory.user_id == buyer.id, ConversationHistory.thread_type.in_(["sera", "compare"])
                )
                .order_by(ConversationHistory.updated_at.desc())
            )
        ).scalars()
        seen: set[str] = set()
        result = []
        for row in rows:
            if row.thread_id not in seen:
                result.append(
                    {
                        "id": row.thread_id,
                        "type": row.thread_type,
                        "title": row.metadata_json.get("title", "Vehicle advice"),
                        "updated_at": row.updated_at.isoformat(),
                    }
                )
                seen.add(row.thread_id)
        return result

    @log_flow(layer="service")
    async def save_guided_checkpoint(self, payload: AiGuidedCheckpoint, buyer: Profile) -> None:
        """Persist the guided chat transcript and current picker state for reloads and chat history."""
        latest = (
            await self.session.execute(
                select(ConversationHistory)
                .where(ConversationHistory.thread_id == payload.thread_id, ConversationHistory.user_id == buyer.id)
                .order_by(ConversationHistory.updated_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        messages = [message.model_dump() for message in payload.messages]
        if (
            latest
            and latest.checkpoint.get("guided_messages") == messages
            and latest.checkpoint.get("guided_state") == payload.guided_state
            and latest.checkpoint.get("request_context") == payload.request_context
        ):
            return
        previous = latest.checkpoint if latest else {}
        first_user_message = next((message["body"] for message in messages if message["role"] == "user"), "")
        request = payload.request_context or {}
        vehicle = " ".join(
            part for part in (str(request.get("brand", "")).strip(), str(request.get("model", "")).strip()) if part
        )
        title = f"Buying request: {vehicle}" if vehicle else (first_user_message[:72] or "New Sera chat")
        last_user = next((message["body"] for message in reversed(messages) if message["role"] == "user"), "")
        last_assistant = next((message["body"] for message in reversed(messages) if message["role"] == "assistant"), "")
        self.session.add(
            ConversationHistory(
                thread_id=payload.thread_id,
                checkpoint_id=str(uuid4()),
                parent_checkpoint_id=latest.checkpoint_id if latest else None,
                user_id=buyer.id,
                thread_type="sera",
                checkpoint={
                    "user": last_user,
                    "assistant": last_assistant,
                    "requirements": previous.get("requirements", {}),
                    "preferences": previous.get("preferences", {}),
                    "preferences_pending": previous.get("preferences_pending", False),
                    "published_request": previous.get("published_request"),
                    "published_request_id": payload.guided_state.get("publishedRequestId"),
                    "request_context": payload.request_context or previous.get("request_context"),
                    "preference_action": previous.get("preference_action"),
                    "preference_prompted": bool(previous.get("preference_prompted")),
                    "entry_mode": previous.get("entry_mode"),
                    "guided_messages": messages,
                    "guided_state": payload.guided_state,
                    # Picks made on the guided card (car, city, timing) join the chat's memory.
                    "chat_summary": update_summary(
                        previous.get("chat_summary"),
                        user_message=None,
                        answer=None,
                        request_context=payload.request_context,
                        published_request_id=payload.guided_state.get("publishedRequestId"),
                    ),
                },
                metadata_json={"title": title, "agent": "sera-guided", "saved_at": datetime.now(UTC).isoformat()},
            )
        )
        await self.session.commit()

    @log_flow(layer="service")
    async def get_thread(self, thread_id: str, buyer: Profile) -> dict:
        rows = (
            (
                await self.session.execute(
                    select(ConversationHistory)
                    .where(ConversationHistory.thread_id == thread_id, ConversationHistory.user_id == buyer.id)
                    .order_by(ConversationHistory.created_at)
                )
            )
            .scalars()
            .all()
        )
        if not rows:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "AI thread not found.", 404)
        return {"id": thread_id, "checkpoints": [row.checkpoint for row in rows]}

    @log_flow(layer="service")
    async def delete_thread(self, thread_id: str, buyer: Profile) -> None:
        owned_thread = (
            await self.session.execute(
                select(ConversationHistory.thread_id)
                .where(
                    ConversationHistory.thread_id == thread_id,
                    ConversationHistory.user_id == buyer.id,
                    ConversationHistory.thread_type.in_(["sera", "compare"]),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if owned_thread is None:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "AI thread not found.", 404)
        await self.session.execute(
            delete(ConversationHistory).where(
                ConversationHistory.thread_id == thread_id,
                ConversationHistory.user_id == buyer.id,
                ConversationHistory.thread_type.in_(["sera", "compare"]),
            )
        )
        await self.session.commit()

    @log_flow(layer="service")
    async def _latest_memory(self, thread_id: str, user_id: str) -> dict:
        rows = (
            (
                await self.session.execute(
                    select(ConversationHistory)
                    .where(ConversationHistory.thread_id == thread_id, ConversationHistory.user_id == user_id)
                    .order_by(ConversationHistory.created_at.desc())
                    .limit(10)
                )
            )
            .scalars()
            .all()
        )
        if not rows:
            return {}
        latest = rows[0].checkpoint
        chronological = list(reversed(rows))
        # The browser also saves its whole transcript ("guided_messages") after a turn, beside Sera's own turn row.
        # The newest such transcript is the base, and only Sera's turns saved after it are appended. Merging every
        # copy used to put old messages ("Your name is Siri") after the latest shortlist and push it out of view.
        transcript_at = max(
            (
                index
                for index, row in enumerate(chronological)
                if isinstance(row.checkpoint.get("guided_messages"), list)
            ),
            default=None,
        )
        context: list[dict[str, Any]] = []
        if transcript_at is not None:
            for message in chronological[transcript_at].checkpoint["guided_messages"]:
                if isinstance(message, dict) and message.get("role") in {"user", "assistant"} and message.get("body"):
                    item: dict[str, Any] = {"role": message["role"], "body": str(message["body"])[:4000]}
                    if message["role"] == "assistant" and isinstance(message.get("media"), list):
                        item["media"] = message["media"][:8]
                    context.append(item)
        for row in chronological[(transcript_at + 1) if transcript_at is not None else 0 :]:
            checkpoint = row.checkpoint
            if isinstance(checkpoint.get("guided_messages"), list):
                continue
            for role, key in (("user", "user"), ("assistant", "assistant")):
                body = checkpoint.get(key)
                if body:
                    item = {"role": role, "body": str(body)[:2000]}
                    if role == "assistant" and isinstance(checkpoint.get("media"), list):
                        item["media"] = checkpoint["media"]
                    context.append(item)
        # Only back-to-back repeats are duplicates; a buyer saying "ok" twice in different places is not.
        deduped: list[dict[str, Any]] = []
        for message in context:
            if not deduped or (deduped[-1]["role"], deduped[-1]["body"]) != (message["role"], message["body"]):
                deduped.append(message)
        # Chats saved before memory existed get a summary rebuilt from the turns still loaded.
        return {
            **latest,
            "conversation_context": deduped[-20:],
            "chat_summary": latest.get("chat_summary") or bootstrap_summary(deduped),
        }

    async def _buyer_preferences(self, user_id: str) -> dict:
        from src.repositories.schema import BuyerPreference

        row = await self.session.get(BuyerPreference, user_id)
        if row is None:
            return {}
        values = {
            key: value
            for key, value in model_dict(row).items()
            if key not in {"profile_id", "created_at", "updated_at", "created_by", "updated_by", "source", "id"}
            and value not in (None, [], "")
        }
        return values

    @log_flow(layer="service")
    async def _save_checkpoint(
        self,
        thread_id: str,
        user_id: str,
        payload: AiChatRequest,
        main: dict,
        requirements: dict,
        memory: dict | None = None,
        trace_id: str | None = None,
    ) -> None:
        memory = memory or {}
        controls = {"use_saved", "customize", "update_saved", "skip"}
        is_control = payload.preference_action in controls
        preference_choice = main.get("route") == "preference_choice"
        active_request = (
            payload.message
            if preference_choice and payload.preference_action is None
            else memory.get("active_request")
            if payload.preference_action == "update_saved"
            else None
            if is_control or payload.preference_action == "continue_without_saved"
            else memory.get("active_request")
        )
        user_message = None if is_control else payload.message
        new_draft = bool(requirements.get("vehicle_selection"))
        chat_summary = update_summary(
            memory.get("chat_summary"),
            user_message=user_message,
            answer=main.get("answer"),
            route=main.get("route"),
            requirements=requirements.get("requirements"),
            request_context=payload.request_context,
            published_request_id=(main.get("published_request") or {}).get("id"),
        )
        # The buyer's answer to the preferences card holds for the rest of the chat, so it is never asked again.
        preference_decision = (
            payload.preference_action
            if payload.preference_action in {"use_saved", "customize", "skip", "continue_without_saved"}
            else memory.get("preference_action")
        )
        self.session.add(
            ConversationHistory(
                thread_id=thread_id,
                checkpoint_id=str(uuid4()),
                user_id=user_id,
                thread_type="compare" if payload.agent == "compare-agent" else "sera",
                checkpoint={
                    "user": user_message,
                    "assistant": main.get("answer"),
                    "media": main.get("media") or [],
                    "sources": main.get("sources") or [],
                    "requirements": requirements.get("requirements") or memory.get("requirements", {}),
                    "questions": requirements.get("suggested_questions", []),
                    "preferences": main.get("preferences") or memory.get("preferences", {}),
                    "preferences_pending": main.get("preferences_pending", memory.get("preferences_pending", False)),
                    # A new request card for another car replaces the one already posted, so "post it" sends the
                    # new car instead of returning the earlier request.
                    "published_request": None
                    if new_draft
                    else main.get("published_request") or memory.get("published_request"),
                    "published_request_id": None
                    if new_draft
                    else memory.get("published_request_id")
                    or (main.get("published_request") or {}).get("id")
                    or (memory.get("published_request") or {}).get("id"),
                    "request_context": payload.request_context or memory.get("request_context"),
                    "active_request": active_request,
                    "preference_action": preference_decision,
                    "preference_prompted": preference_choice or bool(memory.get("preference_prompted")),
                    "entry_mode": memory.get("entry_mode") or payload.entry_mode,
                    "chat_preferences": payload.chat_preferences
                    if payload.preference_action == "customize"
                    else memory.get("chat_preferences"),
                    "preference_card": main.get("preference_card") if preference_choice else None,
                    "chat_summary": chat_summary,
                },
                metadata_json={
                    "title": (
                        payload.message if user_message is not None else memory.get("active_request", "Sera chat")
                    )[:72],
                    "agent": payload.agent,
                    "saved_at": datetime.now(UTC).isoformat(),
                    # Links this turn to its AI trace, so administrators can read Sera's reply beside the trace.
                    **({"trace_id": trace_id} if trace_id else {}),
                },
            )
        )

    @log_flow(layer="service")
    async def _comparison_rows(self, request_ids: list[str], buyer: Profile) -> list[dict]:
        rows: list[dict] = []
        for request_id in request_ids:
            buyer_request = await self.session.get(BuyerRequest, request_id)
            if buyer_request is None or buyer_request.buyer_id != buyer.id:
                raise AppError(error_codes.RESOURCE_NOT_FOUND, "One or more buyer requests were not found.", 404)
            offers = (
                (
                    await self.session.execute(
                        select(DealQuote)
                        .where(DealQuote.buyer_request_id == request_id)
                        .order_by(DealQuote.final_price)
                    )
                )
                .scalars()
                .all()
            )
            request_row = model_dict(buyer_request)
            brand = await self.session.get(Brand, buyer_request.brand_id)
            request_row["brand_name"] = brand.name if brand else "Vehicle"
            quote_rows = []
            for offer in offers:
                quote_row = model_dict(offer)
                dealer = await self.session.get(Profile, offer.dealer_id)
                quote_row["dealer_name"] = (dealer.dealership_name or dealer.full_name) if dealer else "Verified dealer"
                quote_rows.append(quote_row)
            rows.append(
                {"request": request_row, "quotes": quote_rows, "best_quote": quote_rows[0] if quote_rows else None}
            )
        return rows

    @log_flow(layer="service")
    async def _comparison_payload(self, payload: AiChatRequest | CompareRequest, buyer: Profile) -> dict:
        if payload.request_ids:
            return {"requestIds": payload.request_ids, "rows": await self._comparison_rows(payload.request_ids, buyer)}
        rows: list[dict] = []
        request_ids: list[str] = []
        for quote_id in payload.quote_ids:
            quote = await self.session.get(DealQuote, quote_id)
            if quote is None or quote.buyer_id != buyer.id:
                raise AppError(error_codes.RESOURCE_NOT_FOUND, "One or more quotes were not found.", 404)
            quote_row = model_dict(quote)
            dealer = await self.session.get(Profile, quote.dealer_id)
            quote_row["dealer_name"] = (dealer.dealership_name or dealer.full_name) if dealer else "Verified dealer"
            buyer_request = await self.session.get(BuyerRequest, quote.buyer_request_id)
            if buyer_request:
                brand = await self.session.get(Brand, buyer_request.brand_id)
                quote_row["vehicle"] = f"{brand.name if brand else 'Vehicle'} {buyer_request.model}"
            rows.append(quote_row)
            if quote.buyer_request_id not in request_ids:
                request_ids.append(quote.buyer_request_id)
        return {"requestIds": request_ids, "quoteIds": payload.quote_ids, "rows": rows}
