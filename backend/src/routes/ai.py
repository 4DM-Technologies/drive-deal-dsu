import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.middleware.auth import require_roles
from src.models.marketplace import AiChatRequest, CompareRequest
from src.repositories.schema import Profile
from src.services.ai_service import AiService

router = APIRouter(prefix="/ai", tags=["AI"])


@router.post("/chat")
async def chat(payload: AiChatRequest, profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)):
    service = AiService(session)

    async def event_stream():
        async for event in service.stream_chat(payload, profile):
            yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/compare")
async def compare(payload: CompareRequest, profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)):
    return await AiService(session).compare(payload, profile)


@router.get("/threads")
async def threads(profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)):
    return await AiService(session).list_threads(profile)


@router.get("/threads/{thread_id}")
async def thread(thread_id: str, profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)):
    return await AiService(session).get_thread(thread_id, profile)


@router.post("/request-preview")
async def request_preview(payload: AiChatRequest, profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)):
    events = []
    async for event in AiService(session).stream_chat(payload, profile):
        if event["type"] == "card" and event["kind"] == "requestPreview":
            events.append(event["payload"])
    return {"previews": events, "confirmation_required": True}
