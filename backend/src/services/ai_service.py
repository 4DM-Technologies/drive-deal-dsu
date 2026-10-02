import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.agents.requirements import build_requirement_graph
from src.agents.serra.graph import DIRECT_REPLY_ROUTES, is_direct_reply, main_agent
from src.models.marketplace import AiChatRequest, CompareRequest
from src.repositories.schema import Brand, BuyerRequest, ConversationHistory, DealQuote, Profile
from src.settings import get_settings
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow
from src.utils.serialization import model_dict


class AiService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @log_flow(layer="service")
    async def stream_chat(self, payload: AiChatRequest, buyer: Profile):
        thread_id = payload.thread_id or str(uuid4())
        if get_settings().ai_disabled:
            async for event in self._stream_demo(payload, buyer, thread_id):
                yield event
            return
        memory = await self._latest_memory(thread_id, buyer.id)
        state = {
            "user_id": buyer.id,
            "thread_id": thread_id,
            "message": payload.message,
            "requirements": memory.get("requirements", {}),
            "preferences": memory.get("preferences", {}),
            "preferences_pending": memory.get("preferences_pending", False),
        }
        yield {"type": "status", "phase": "classifying", "label": "Thinking"}
        await asyncio.sleep(0)
        comparison_payload = None
        if payload.agent == "compare-agent" and (payload.request_ids or payload.quote_ids):
            comparison_payload = await self._comparison_payload(payload, buyer)
            state["comparison_rows"] = comparison_payload["rows"]
        main_graph = main_agent(self.session, compare=payload.agent == "compare-agent")
        main_task = asyncio.create_task(main_graph.ainvoke(state))
        if payload.agent == "compare-agent":
            main_result = await main_task
            requirement_result = {}
        elif is_direct_reply(payload.message):
            # A greeting or an instruction-override attempt is answered by the main model alone, so the
            # requirements graph is never started: there is no requirement in the message to extract.
            main_result = await main_task
            requirement_result: dict = {}
        else:
            requirement_task = asyncio.create_task(build_requirement_graph(self.session).ainvoke(state))
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
        if main_result.get("sources"):
            yield {"type": "status", "phase": "crawling", "label": "Searching trusted sources"}
        yield {"type": "status", "phase": "composing", "label": "Preparing response"}
        answer = main_result.get("answer", "I could not prepare an answer from the available evidence.")
        for index in range(0, len(answer), 18):
            yield {"type": "token", "text": answer[index:index + 18]}
            await asyncio.sleep(0)
        if comparison_payload is not None:
            yield {"type": "card", "kind": "compare", "payload": comparison_payload}
        if not requirement_result.get("missing_fields") and requirement_result.get("requirements"):
            yield {"type": "card", "kind": "requestPreview", "payload": {**requirement_result["requirements"], "confirmation_required": True}}
        elif requirement_result.get("suggested_questions"):
            yield {"type": "card", "kind": "requestPreview", "payload": {"questions": requirement_result["suggested_questions"], "draft": requirement_result.get("requirements", {})}}
        if main_result.get("sources"):
            yield {"type": "sources", "items": main_result["sources"]}
        await self._save_checkpoint(thread_id, buyer.id, payload, main_result, requirement_result)
        await self.session.commit()
        yield {"type": "done", "threadId": thread_id, "messagesUsed": 1, "expandedUi": False}

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
            card = {"type": "card", "kind": "requestPreview", "payload": {"brand": "Ford", "model": "Bronco", "years": "2024–2026", "budget": "$65,000–$72,000 OTD", "area": "Austin, TX · 75 miles", "timeline": "Within 2 weeks", "mustHaves": "4WD, hard top, adaptive cruise"}}
        else:
            answer = "## Let’s make this decision easier\nTell me what you care about most: daily comfort, family space, performance, running cost, or the lowest possible price.\n## I can help with\n- A focused vehicle shortlist\n- Side-by-side dealer quote comparisons\n- Questions worth asking before you accept\n- An editable request you approve before posting"
            card = None
        for index in range(0, len(answer), 14):
            yield {"type": "token", "text": answer[index:index + 14]}
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
            "message": "Compare the selected dealer offers and recommend the strongest option.",
            "comparison_rows": rows,
        }
        result = await main_agent(self.session, compare=True).ainvoke(state)
        await self.session.commit()
        return {
            "request_ids": request_ids,
            "quote_ids": comparison.get("quoteIds", []),
            "rows": rows,
            "recommendation": result.get("answer"),
            "not_reported_policy": "Fields not supplied by a dealer are never inferred.",
        }

    @log_flow(layer="service")
    async def list_threads(self, buyer: Profile) -> list[dict]:
        rows = (await self.session.execute(select(ConversationHistory).where(ConversationHistory.user_id == buyer.id, ConversationHistory.thread_type.in_(["sera", "compare"])).order_by(ConversationHistory.updated_at.desc()))).scalars()
        seen: set[str] = set()
        result = []
        for row in rows:
            if row.thread_id not in seen:
                result.append({"id": row.thread_id, "type": row.thread_type, "title": row.metadata_json.get("title", "Vehicle advice"), "updated_at": row.updated_at.isoformat()})
                seen.add(row.thread_id)
        return result

    @log_flow(layer="service")
    async def get_thread(self, thread_id: str, buyer: Profile) -> dict:
        rows = (await self.session.execute(select(ConversationHistory).where(ConversationHistory.thread_id == thread_id, ConversationHistory.user_id == buyer.id).order_by(ConversationHistory.created_at))).scalars().all()
        if not rows:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "AI thread not found.", 404)
        return {"id": thread_id, "checkpoints": [row.checkpoint for row in rows]}

    @log_flow(layer="service")
    async def delete_thread(self, thread_id: str, buyer: Profile) -> None:
        owned_thread = (await self.session.execute(
            select(ConversationHistory.thread_id).where(
                ConversationHistory.thread_id == thread_id,
                ConversationHistory.user_id == buyer.id,
                ConversationHistory.thread_type.in_(["sera", "compare"]),
            ).limit(1)
        )).scalar_one_or_none()
        if owned_thread is None:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "AI thread not found.", 404)
        await self.session.execute(delete(ConversationHistory).where(
            ConversationHistory.thread_id == thread_id,
            ConversationHistory.user_id == buyer.id,
            ConversationHistory.thread_type.in_(["sera", "compare"]),
        ))
        await self.session.commit()

    @log_flow(layer="service")
    async def _latest_memory(self, thread_id: str, user_id: str) -> dict:
        row = (await self.session.execute(select(ConversationHistory).where(ConversationHistory.thread_id == thread_id, ConversationHistory.user_id == user_id).order_by(ConversationHistory.created_at.desc()).limit(1))).scalar_one_or_none()
        return row.checkpoint if row else {}

    @log_flow(layer="service")
    async def _save_checkpoint(self, thread_id: str, user_id: str, payload: AiChatRequest, main: dict, requirements: dict) -> None:
        self.session.add(ConversationHistory(
            thread_id=thread_id, checkpoint_id=str(uuid4()), user_id=user_id,
            thread_type="compare" if payload.agent == "compare-agent" else "sera",
            checkpoint={
                "user": payload.message, "assistant": main.get("answer"), "requirements": requirements.get("requirements", {}),
                "questions": requirements.get("suggested_questions", []), "preferences": main.get("preferences", {}),
                "preferences_pending": main.get("preferences_pending", False),
            },
            metadata_json={"title": payload.message[:72], "agent": payload.agent, "saved_at": datetime.now(UTC).isoformat()},
        ))

    @log_flow(layer="service")
    async def _comparison_rows(self, request_ids: list[str], buyer: Profile) -> list[dict]:
        rows: list[dict] = []
        for request_id in request_ids:
            buyer_request = await self.session.get(BuyerRequest, request_id)
            if buyer_request is None or buyer_request.buyer_id != buyer.id:
                raise AppError(error_codes.RESOURCE_NOT_FOUND, "One or more buyer requests were not found.", 404)
            offers = (await self.session.execute(select(DealQuote).where(DealQuote.buyer_request_id == request_id).order_by(DealQuote.final_price))).scalars().all()
            request_row = model_dict(buyer_request)
            brand = await self.session.get(Brand, buyer_request.brand_id)
            request_row["brand_name"] = brand.name if brand else "Vehicle"
            quote_rows = []
            for offer in offers:
                quote_row = model_dict(offer)
                dealer = await self.session.get(Profile, offer.dealer_id)
                quote_row["dealer_name"] = (dealer.dealership_name or dealer.full_name) if dealer else "Verified dealer"
                quote_rows.append(quote_row)
            rows.append({"request": request_row, "quotes": quote_rows, "best_quote": quote_rows[0] if quote_rows else None})
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
