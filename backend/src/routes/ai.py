import json

from fastapi import APIRouter, Depends, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.middleware.auth import require_roles
from src.models.marketplace import AiChatRequest, CompareRequest
from src.repositories.schema import Profile
from src.services.ai_service import AiService
from src.utils.log_flow import log_flow

router = APIRouter(prefix="/ai", tags=["AI"])


@router.post("/chat")
@log_flow(layer="route")
async def chat(
    payload: AiChatRequest,
    profile: Profile = Depends(require_roles("buyer")),
    session: AsyncSession = Depends(get_session),
):
    service = AiService(session)

    @log_flow(layer="route")
    async def event_stream():
        async for event in service.stream_chat(payload, profile):
            yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@router.post("/compare")
@log_flow(layer="route")
async def compare(
    payload: CompareRequest,
    profile: Profile = Depends(require_roles("buyer")),
    session: AsyncSession = Depends(get_session),
):
    return await AiService(session).compare(payload, profile)


@router.get("/threads")
@log_flow(layer="route")
async def threads(profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)):
    return await AiService(session).list_threads(profile)


@router.get("/threads/{thread_id}")
@log_flow(layer="route")
async def thread(
    thread_id: str, profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)
):
    return await AiService(session).get_thread(thread_id, profile)


@router.delete("/threads/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
@log_flow(layer="route")
async def delete_thread(
    thread_id: str, profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)
):
    await AiService(session).delete_thread(thread_id, profile)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/request-preview")
@log_flow(layer="route")
async def request_preview(
    payload: AiChatRequest,
    profile: Profile = Depends(require_roles("buyer")),
    session: AsyncSession = Depends(get_session),
):
    events = []
    async for event in AiService(session).stream_chat(payload, profile):
        if event["type"] == "card" and event["kind"] == "requestPreview":
            events.append(event["payload"])
    return {"previews": events, "confirmation_required": True}
