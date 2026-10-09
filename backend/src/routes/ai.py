import json

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.middleware.auth import require_roles
from src.models.guided import GuidedNextRequest
from src.models.marketplace import AiChatRequest, AiGuidedCheckpoint, CompareRequest
from src.repositories.schema import Profile
from src.services.ai_service import AiService
from src.services.catalog.planner import GuidedPlanner
from src.utils.log_flow import log_flow
from src.utils.logger import logger

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
        try:
            async for event in service.stream_chat(payload, profile):
                yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
        except Exception as exc:
            # A node can deliberately fail loudly (e.g. OrchestratorPlanError) rather than silently falling
            # back to guessed behavior. That must still reach the buyer as a clean stream event instead of
            # killing the SSE connection mid-response and leaving the frontend stuck on a "thinking" state.
            logger.exception("ai_chat_stream_failed", thread_id=payload.thread_id, error=str(exc)[:300])
            error_event = {
                "type": "error",
                "message": "Something went wrong while preparing a response. Please try again.",
            }
            yield f"event: {error_event['type']}\ndata: {json.dumps(error_event)}\n\n"

    return StreamingResponse(
        event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@router.post("/guided/next")
@log_flow(layer="route")
async def guided_next(
    payload: GuidedNextRequest,
    profile: Profile = Depends(require_roles("buyer")),
    session: AsyncSession = Depends(get_session),
):
    """Next question of the guided card, or the finished request draft. Deterministic: no LLM call."""
    step = await GuidedPlanner(session).next(payload)
    return step.model_dump()


@router.get("/vehicle-images")
@log_flow(layer="route")
async def vehicle_images(
    query: str = Query(min_length=2, max_length=180),
    profile: Profile = Depends(require_roles("buyer")),
    session: AsyncSession = Depends(get_session),
):
    results = await AiService(session).vehicle_images(query)
    await session.commit()
    return {"items": results}


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


@router.post("/threads/guided-checkpoint", status_code=status.HTTP_204_NO_CONTENT)
@log_flow(layer="route")
async def save_guided_checkpoint(
    payload: AiGuidedCheckpoint,
    profile: Profile = Depends(require_roles("buyer")),
    session: AsyncSession = Depends(get_session),
):
    await AiService(session).save_guided_checkpoint(payload, profile)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
    service = AiService(session)
    events = []
    async for event in service.stream_chat(payload, profile):
        if event["type"] == "card" and event["kind"] == "requestPreview":
            events.append(event["payload"])
    gate = await service.posting_gate(profile)
    return {"previews": events, "confirmation_required": True, **gate}
