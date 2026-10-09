import asyncio
import re
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from time import perf_counter
from uuid import uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.agents.llm import LlmClient
from src.agents.requirements import build_requirement_graph
from src.agents.serra.graph import (
    DIRECT_REPLY_ROUTES,
    is_direct_reply,
    is_explicit_image_search,
    is_explicit_web_search,
    is_ranking_request,
    main_agent,
)
from src.agents.tools.web_search import search_vehicle_images
from src.database import SessionFactory
from src.models.guided import GuidedStep
from src.models.marketplace import AiChatRequest, AiGuidedCheckpoint, CompareRequest, RequestCreate
from src.repositories.schema import (
    AiTrace,
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
from src.settings import get_settings
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow
from src.utils.serialization import model_dict

_PUBLISH_CONFIRMATION_RE = re.compile(
    r"^\s*(?:yes[, ]*)?(?:please\s+)?(?:post|publish|send)\s+(?:it|this|the\s+(?:request|post)|my\s+(?:request|post))\s*[!.]*$",
    re.IGNORECASE,
)


def _is_publish_confirmation(message: str) -> bool:
    return bool(_PUBLISH_CONFIRMATION_RE.fullmatch(message))


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


class AiService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def vehicle_images(self, query: str, thread_id: str | None = None) -> list[dict[str, str]]:
        """Find attributed reference images without blocking the request create/publish flow."""
        settings = get_settings()
        if settings.ai_disabled or not settings.ai_enable_web_search:
            return []
        if not re.search(r"\b(?:model\s+[a-z0-9]+|[a-z][a-z0-9-]{1,})\b", query, re.I):
            return []
        return await search_vehicle_images(LlmClient(self.session), query, thread_id=thread_id, limit=4)

    @log_flow(layer="service")
    async def _publish_saved_requirements(self, requirements: dict, buyer: Profile) -> dict | None:
        """Turn a complete requirement checkpoint into a draft and publish it after explicit confirmation."""
        required = ("brand", "buyer_area", "state", "timeline")
        if any(not requirements.get(field) for field in required):
            return None
        model_name = requirements.get("model") or requirements.get("model_name")
        if not model_name:
            return None
        brand = await self.session.execute(
            select(Brand).where(Brand.name.ilike(str(requirements["brand"])))
        ).scalar_one_or_none()
        state = await self.session.execute(
            select(State).where(State.name.ilike(str(requirements["state"])))
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
        if get_settings().ai_disabled:
            async for event in self._stream_demo(payload, buyer, thread_id):
                yield event
            return
        memory = await self._latest_memory(thread_id, buyer.id)
        trace_id = str(uuid4())
        trace_started = perf_counter()
        state = {
            "user_id": buyer.id,
            "thread_id": thread_id,
            "trace_id": trace_id,
            "message": payload.message,
            "requirements": memory.get("requirements", {}),
            "preferences": memory.get("preferences", {}),
            "preferences_pending": memory.get("preferences_pending", False),
            "conversation_context": [{"request_context": payload.request_context or memory.get("request_context")}]
            if payload.request_context or memory.get("request_context")
            else [],
        }
        explicit_web_search = (
            get_settings().ai_enable_web_search
            and (
                is_explicit_web_search(payload.message)
                or is_explicit_image_search(payload.message)
                or is_ranking_request(payload.message)
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
            query=payload.message[:4000],
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
                    thread_id, buyer.id, payload, main_result, {"requirements": state.get("requirements", {})}
                )
                await self.session.commit()
                yield {"type": "done", "threadId": thread_id, "messagesUsed": 1, "expandedUi": False}
                return
        # Guided question card. A message naming a catalog vehicle with buying intent ("I want a BMW M3") opens the
        # card. When nothing else was asked, the card is the whole reply: a template sentence and no LLM call.
        guided_step: GuidedStep | None = None
        if payload.agent != "compare-agent" and not explicit_web_search:
            match = await match_message(self.session, payload.message)
            if match.opens_card:
                guided_step = await GuidedPlanner(self.session).from_match(match)
                reply = await self._guided_reply(match, guided_step) if match.card_only else None
                if reply is not None:
                    main_result = {"route": "guided_card", "answer": reply}
                    yield {"type": "token", "text": reply}
                    if guided_step is not None:
                        yield {"type": "card", "kind": "question", "payload": guided_step.model_dump()}
                    await self._finish_trace(trace, main_result, trace_started)
                    await self._save_checkpoint(thread_id, buyer.id, payload, main_result, {})
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
        elif is_direct_reply(payload.message) or explicit_web_search or guided_step is not None:
            # Greetings and explicit research requests are handled entirely by the main graph. Neither contains
            # a buyer requirement to extract, so starting the requirements graph would add latency and UI cards.
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
        await self._save_checkpoint(thread_id, buyer.id, payload, main_result, requirement_result)
        await self.session.commit()
        yield {"type": "done", "threadId": thread_id, "messagesUsed": 1, "expandedUi": False}

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
    async def _stream_demo(self, payload: AiChatRequest, buyer: Profile, thread_id: str):
        """Stream a deterministic product demo without invoking any agent workflow."""
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
        trace.status = "success"
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
                    "request_context": payload.request_context or previous.get("request_context"),
                    "guided_messages": messages,
                    "guided_state": payload.guided_state,
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
        row = (
            await self.session.execute(
                select(ConversationHistory)
                .where(ConversationHistory.thread_id == thread_id, ConversationHistory.user_id == user_id)
                .order_by(ConversationHistory.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        return row.checkpoint if row else {}

    @log_flow(layer="service")
    async def _save_checkpoint(
        self, thread_id: str, user_id: str, payload: AiChatRequest, main: dict, requirements: dict
    ) -> None:
        self.session.add(
            ConversationHistory(
                thread_id=thread_id,
                checkpoint_id=str(uuid4()),
                user_id=user_id,
                thread_type="compare" if payload.agent == "compare-agent" else "sera",
                checkpoint={
                    "user": payload.message,
                    "assistant": main.get("answer"),
                    "requirements": requirements.get("requirements", {}),
                    "questions": requirements.get("suggested_questions", []),
                    "preferences": main.get("preferences", {}),
                    "preferences_pending": main.get("preferences_pending", False),
                    "published_request": main.get("published_request"),
                    "request_context": payload.request_context,
                },
                metadata_json={
                    "title": payload.message[:72],
                    "agent": payload.agent,
                    "saved_at": datetime.now(UTC).isoformat(),
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
