import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.agents.requirements import build_requirement_graph
from src.agents.serra.graph import build_serra_graph
from src.models.marketplace import AiChatRequest, CompareRequest
from src.repositories.schema import BuyerRequest, ConversationHistory, DealQuote, Profile
from src.settings import get_settings
from src.utils.exceptions import AppError, error_codes
from src.utils.serialization import model_dict


class AiService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

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
        }
        yield {"type": "status", "phase": "classifying", "label": "Understanding your question"}
        await asyncio.sleep(0)
        yield {"type": "status", "phase": "searching", "label": "Checking DriveDeal knowledge"}
        main_graph = build_serra_graph(self.session, compare=payload.agent == "compare-agent")
        requirement_graph = build_requirement_graph()
        main_result, requirement_result = await asyncio.gather(main_graph.ainvoke(state), requirement_graph.ainvoke(state))
        if main_result.get("sources"):
            yield {"type": "status", "phase": "crawling", "label": "Looking this up online"}
        yield {"type": "status", "phase": "composing", "label": "Preparing a useful answer"}
        answer = main_result.get("answer", "I could not prepare an answer from the available evidence.")
        for index in range(0, len(answer), 18):
            yield {"type": "token", "text": answer[index:index + 18]}
            await asyncio.sleep(0)
        if payload.agent == "compare-agent" and (payload.request_ids or payload.quote_ids):
            yield {"type": "card", "kind": "compare", "payload": await self._comparison_payload(payload, buyer)}
        if not requirement_result.get("missing_fields") and requirement_result.get("requirements"):
            yield {"type": "card", "kind": "requestPreview", "payload": {**requirement_result["requirements"], "confirmation_required": True}}
        elif requirement_result.get("suggested_questions"):
            yield {"type": "card", "kind": "requestPreview", "payload": {"questions": requirement_result["suggested_questions"], "draft": requirement_result.get("requirements", {})}}
        if main_result.get("sources"):
            yield {"type": "sources", "items": main_result["sources"]}
        await self._save_checkpoint(thread_id, buyer.id, payload, main_result, requirement_result)
        await self.session.commit()
        yield {"type": "done", "threadId": thread_id, "messagesUsed": 1, "expandedUi": False}

    async def _stream_demo(self, payload: AiChatRequest, buyer: Profile, thread_id: str):
        """Stream a deterministic product demo without invoking any agent workflow."""
        phases = [
            ("classifying", "Understanding your question"),
            ("searching", "Checking the demo knowledge base"),
            ("composing", "Preparing a preview response"),
        ]
        for phase, label in phases:
            yield {"type": "status", "phase": phase, "label": label}
            await asyncio.sleep(0.12)
        lower = payload.message.lower()
        if payload.agent == "compare-agent" and (payload.request_ids or payload.quote_ids):
            comparison = await self._comparison_payload(payload, buyer)
            answer = "I compared the selected offers by out-the-door price, dealer confidence, response speed, and reported gaps. Review the highlighted leader, then open the offer before making your final decision."
            card = {"type": "card", "kind": "compare", "payload": comparison}
        elif "request" in lower or "car" in lower or "buy" in lower:
            answer = "I turned your conversation into an editable buying brief. Check the details below—nothing is published until you choose Post this request."
            card = {"type": "card", "kind": "requestPreview", "payload": {"brand": "Ford", "model": "Bronco", "years": "2024–2026", "budget": "$65,000–$72,000 OTD", "area": "Austin, TX · 75 miles", "timeline": "Within 2 weeks", "mustHaves": "4WD, hard top, adaptive cruise"}}
        else:
            answer = "I can help narrow your vehicle, explain ownership trade-offs, compare dealer quotes, and prepare a request for your approval. Tell me your budget, location, timing, and must-have features to begin."
            card = None
        for index in range(0, len(answer), 14):
            yield {"type": "token", "text": answer[index:index + 14]}
            await asyncio.sleep(0.025)
        if card:
            yield card
        yield {"type": "done", "threadId": thread_id, "messagesUsed": 1, "expandedUi": False}

    async def compare(self, payload: CompareRequest, buyer: Profile) -> dict:
        request_ids = list(payload.request_ids)
        legacy_rows: list[dict] = []
        if not request_ids and payload.quote_ids:
            for quote_id in payload.quote_ids:
                quote = await self.session.get(DealQuote, quote_id)
                if quote is None or quote.buyer_id != buyer.id:
                    raise AppError(error_codes.RESOURCE_NOT_FOUND, "One or more quotes were not found.", 404)
                legacy_rows.append(model_dict(quote))
                if quote.buyer_request_id not in request_ids:
                    request_ids.append(quote.buyer_request_id)
        rows = legacy_rows or await self._comparison_rows(request_ids, buyer)
        state = {"user_id": buyer.id, "thread_id": str(uuid4()), "message": f"Compare these buyer requests and their best offers: {rows}"}
        result = await build_serra_graph(self.session, compare=True).ainvoke(state)
        await self.session.commit()
        return {"request_ids": request_ids, "rows": rows, "recommendation": result.get("answer"), "not_reported_policy": "Fields not supplied by a dealer are never inferred."}

    async def list_threads(self, buyer: Profile) -> list[dict]:
        rows = (await self.session.execute(select(ConversationHistory).where(ConversationHistory.user_id == buyer.id, ConversationHistory.thread_type.in_(["sera", "compare"])).order_by(ConversationHistory.updated_at.desc()))).scalars()
        seen: set[str] = set()
        result = []
        for row in rows:
            if row.thread_id not in seen:
                result.append({"id": row.thread_id, "type": row.thread_type, "title": row.metadata_json.get("title", "Vehicle advice"), "updated_at": row.updated_at.isoformat()})
                seen.add(row.thread_id)
        return result

    async def get_thread(self, thread_id: str, buyer: Profile) -> dict:
        rows = (await self.session.execute(select(ConversationHistory).where(ConversationHistory.thread_id == thread_id, ConversationHistory.user_id == buyer.id).order_by(ConversationHistory.created_at))).scalars().all()
        if not rows:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "AI thread not found.", 404)
        return {"id": thread_id, "checkpoints": [row.checkpoint for row in rows]}

    async def _latest_memory(self, thread_id: str, user_id: str) -> dict:
        row = (await self.session.execute(select(ConversationHistory).where(ConversationHistory.thread_id == thread_id, ConversationHistory.user_id == user_id).order_by(ConversationHistory.created_at.desc()).limit(1))).scalar_one_or_none()
        return row.checkpoint if row else {}

    async def _save_checkpoint(self, thread_id: str, user_id: str, payload: AiChatRequest, main: dict, requirements: dict) -> None:
        self.session.add(ConversationHistory(
            thread_id=thread_id, checkpoint_id=str(uuid4()), user_id=user_id,
            thread_type="compare" if payload.agent == "compare-agent" else "sera",
            checkpoint={"user": payload.message, "assistant": main.get("answer"), "requirements": requirements.get("requirements", {}), "questions": requirements.get("suggested_questions", [])},
            metadata_json={"title": payload.message[:72], "agent": payload.agent, "saved_at": datetime.now(UTC).isoformat()},
        ))

    async def _comparison_rows(self, request_ids: list[str], buyer: Profile) -> list[dict]:
        rows: list[dict] = []
        for request_id in request_ids:
            buyer_request = await self.session.get(BuyerRequest, request_id)
            if buyer_request is None or buyer_request.buyer_id != buyer.id:
                raise AppError(error_codes.RESOURCE_NOT_FOUND, "One or more buyer requests were not found.", 404)
            offers = (await self.session.execute(select(DealQuote).where(DealQuote.buyer_request_id == request_id).order_by(DealQuote.final_price))).scalars().all()
            rows.append({"request": model_dict(buyer_request), "quotes": [model_dict(offer) for offer in offers], "best_quote": model_dict(offers[0]) if offers else None})
        return rows

    async def _comparison_payload(self, payload: AiChatRequest, buyer: Profile) -> dict:
        if payload.request_ids:
            return {"requestIds": payload.request_ids, "rows": await self._comparison_rows(payload.request_ids, buyer)}
        rows: list[dict] = []
        request_ids: list[str] = []
        for quote_id in payload.quote_ids:
            quote = await self.session.get(DealQuote, quote_id)
            if quote is None or quote.buyer_id != buyer.id:
                raise AppError(error_codes.RESOURCE_NOT_FOUND, "One or more quotes were not found.", 404)
            rows.append(model_dict(quote))
            if quote.buyer_request_id not in request_ids:
                request_ids.append(quote.buyer_request_id)
        return {"requestIds": request_ids, "rows": rows}
