import asyncio
import json
from datetime import UTC, datetime
from time import perf_counter
from typing import Annotated
from uuid import uuid4

import yaml
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.agents.configuration import MODEL_CATALOG, NODE_CATALOG, PROMPT_CATALOG, THEME_KEY, WORKFLOW_KEY
from src.agents.serra.graph import main_agent
from src.database import SessionFactory, get_session
from src.middleware.auth import require_roles
from src.models.administration import (
    ConfigType,
    DraftSaveRequest,
    PublishConfigRequest,
    SetDefaultRequest,
    ValidateConfigRequest,
    WorkflowPreviewRequest,
)
from src.repositories.schema import AiTrace, AiTraceSpan, ConversationHistory, LlmAudit, Profile
from src.services.administration_service import AdministrationService, serialize_trace_spans
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow

router = APIRouter(tags=["Administration"])
admin_profile = require_roles("support-admin", "admin")


@router.get("/theme/active")
@log_flow(layer="route")
async def active_theme(session: AsyncSession = Depends(get_session)):
    """Public, non-sensitive brand tokens used before authentication screens render."""
    return await AdministrationService(session).active_theme()


@router.get("/administration/catalog")
@log_flow(layer="route")
async def catalog(_: Profile = Depends(admin_profile)):
    return {
        "workflow_key": WORKFLOW_KEY,
        "theme_key": THEME_KEY,
        "nodes": NODE_CATALOG,
        "prompts": PROMPT_CATALOG,
        "models": MODEL_CATALOG,
    }


@router.get("/administration/config/{config_type}/{config_key}")
@log_flow(layer="route")
async def config_bundle(
    config_type: ConfigType,
    config_key: str,
    _: Profile = Depends(admin_profile),
    session: AsyncSession = Depends(get_session),
):
    return await AdministrationService(session).config_bundle(config_type, config_key)


@router.post("/administration/config/{config_type}/{config_key}/validate")
@log_flow(layer="route")
async def validate_config(
    config_type: ConfigType,
    config_key: str,
    payload: ValidateConfigRequest,
    _: Profile = Depends(admin_profile),
):
    errors = AdministrationService.validate_payload(config_type, config_key, payload.payload)
    return {"valid": not errors, "errors": errors}


@router.post("/administration/config/{config_type}/{config_key}/draft")
@log_flow(layer="route")
async def save_draft(
    config_type: ConfigType,
    config_key: str,
    payload: DraftSaveRequest,
    actor: Profile = Depends(admin_profile),
    session: AsyncSession = Depends(get_session),
):
    return await AdministrationService(session).save_draft(
        config_type, config_key, payload.payload, actor.id, payload.base_version
    )


@router.post("/administration/config/{config_type}/{config_key}/publish")
@log_flow(layer="route")
async def publish_config(
    config_type: ConfigType,
    config_key: str,
    payload: PublishConfigRequest,
    actor: Profile = Depends(admin_profile),
    session: AsyncSession = Depends(get_session),
):
    return await AdministrationService(session).publish(config_type, config_key, payload.revision_id, actor.id)


@router.post("/administration/config/{config_type}/{config_key}/rollback/{version}")
@log_flow(layer="route")
async def rollback_config(
    config_type: ConfigType,
    config_key: str,
    version: int,
    actor: Profile = Depends(admin_profile),
    session: AsyncSession = Depends(get_session),
):
    return await AdministrationService(session).rollback(config_type, config_key, version, actor.id)


@router.post("/administration/config/{config_type}/{config_key}/default")
@log_flow(layer="route")
async def set_default_config(
    config_type: ConfigType,
    config_key: str,
    payload: SetDefaultRequest,
    actor: Profile = Depends(admin_profile),
    session: AsyncSession = Depends(get_session),
):
    return await AdministrationService(session).set_default(config_type, config_key, payload.version, actor.id)


@router.post("/administration/config/{config_type}/{config_key}/reset")
@log_flow(layer="route")
async def reset_default_config(
    config_type: ConfigType,
    config_key: str,
    actor: Profile = Depends(admin_profile),
    session: AsyncSession = Depends(get_session),
):
    return await AdministrationService(session).reset_to_default(config_type, config_key, actor.id)


@router.get("/administration/prompts")
@log_flow(layer="route")
async def prompts(_: Profile = Depends(admin_profile), session: AsyncSession = Depends(get_session)):
    return await AdministrationService(session).prompt_bundles()


@router.get("/administration/audit")
@log_flow(layer="route")
async def audit_history(
    limit: Annotated[int, Query(ge=1, le=250)] = 100,
    _: Profile = Depends(admin_profile),
    session: AsyncSession = Depends(get_session),
):
    return await AdministrationService(session).audit_history(limit)


@router.get("/administration/traces")
@log_flow(layer="route")
async def trace_history(
    limit: Annotated[int, Query(ge=1, le=250)] = 100,
    _: Profile = Depends(admin_profile),
    session: AsyncSession = Depends(get_session),
):
    return await AdministrationService(session).trace_history(limit)


@router.get("/administration/traces/{trace_id}")
@log_flow(layer="route")
async def trace_detail(
    trace_id: str,
    _: Profile = Depends(admin_profile),
    session: AsyncSession = Depends(get_session),
):
    return await AdministrationService(session).trace_detail(trace_id)


@router.get("/administration/export")
@log_flow(layer="route")
async def export_configuration(
    format: Annotated[str, Query(pattern="^(json|yaml)$")] = "yaml",
    _: Profile = Depends(admin_profile),
    session: AsyncSession = Depends(get_session),
):
    snapshot = await AdministrationService(session).export_snapshot()
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    if format == "json":
        body = json.dumps(snapshot, indent=2, ensure_ascii=False, default=str)
        media_type, extension = "application/json", "json"
    else:
        body = yaml.safe_dump(snapshot, sort_keys=False, allow_unicode=True)
        media_type, extension = "application/yaml", "yaml"
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="deal-drive-config-{stamp}.{extension}"'},
    )


async def _prepare_preview(
    payload: WorkflowPreviewRequest,
    actor_id: str,
    session: AsyncSession,
) -> tuple[dict, dict, str, str, float, dict]:
    service = AdministrationService(session)
    thread_prefix = f"admin-preview-{actor_id[:8]}-"
    requested_thread = (payload.thread_id or uuid4().hex[:12]).strip()
    preview_thread_id = (
        requested_thread
        if requested_thread.startswith(thread_prefix)
        else f"{thread_prefix}{requested_thread[: 80 - len(thread_prefix)]}"
    )
    if payload.workflow_payload is not None:
        errors = service.validate_payload("workflow", WORKFLOW_KEY, payload.workflow_payload)
        if errors:
            raise AppError(error_codes.VALIDATION_ERROR, "Workflow validation failed.", 422, {"errors": errors})
        workflow = payload.workflow_payload
    else:
        workflow = await service.workflow_for_revision(payload.revision_id)
    runtime = await service.runtime_bundle()
    if payload.prompt_key and payload.prompt_payload:
        errors = service.validate_payload("prompt", payload.prompt_key, payload.prompt_payload)
        if errors:
            raise AppError(error_codes.VALIDATION_ERROR, "Prompt validation failed.", 422, {"errors": errors})
        runtime["prompts"][payload.prompt_key] = payload.prompt_payload["content"]
        runtime["agent_profiles"][payload.prompt_key] = {
            "model": payload.prompt_payload["model"],
            "reasoning_effort": payload.prompt_payload["reasoning_effort"],
            "max_output_tokens": payload.prompt_payload["max_output_tokens"],
        }
    trace_id = str(uuid4())
    started = perf_counter()
    configuration_version = f"preview:{str(payload.revision_id or runtime['version'])[:24]}"
    session.add(
        AiTrace(
            id=trace_id,
            thread_id=preview_thread_id,
            user_id=actor_id,
            query=payload.message,
            status="running",
            is_test=True,
            configuration_version=configuration_version,
            created_by=actor_id,
            updated_by=actor_id,
        )
    )
    await session.flush()
    checkpoint_rows = (
        (
            await session.execute(
                select(ConversationHistory)
                .where(
                    ConversationHistory.thread_id == preview_thread_id,
                    ConversationHistory.user_id == actor_id,
                    ConversationHistory.thread_type == "admin-preview",
                )
                .order_by(ConversationHistory.created_at.desc())
                .limit(6)
            )
        )
        .scalars()
        .all()
    )
    conversation_context = [
        {
            "user": str(row.checkpoint.get("user", ""))[:2000],
            "assistant": str(row.checkpoint.get("assistant", ""))[:4000],
        }
        for row in reversed(checkpoint_rows)
    ]
    state = {
        "user_id": actor_id,
        "thread_id": preview_thread_id,
        "trace_id": trace_id,
        "message": payload.message,
        "conversation_context": conversation_context,
        "requirements": {},
        "preferences": {},
        "preferences_pending": False,
        "preview": True,
    }
    return workflow, runtime, actor_id, trace_id, started, state


async def _finalize_preview(
    session: AsyncSession,
    payload: WorkflowPreviewRequest,
    runtime: dict,
    actor_id: str,
    trace_id: str,
    started: float,
    state: dict,
    result: dict,
) -> dict:
    span_rows = (
        (
            await session.execute(
                select(AiTraceSpan).where(AiTraceSpan.trace_id == trace_id).order_by(AiTraceSpan.sequence)
            )
        )
        .scalars()
        .all()
    )
    llm_rows = (
        (await session.execute(select(LlmAudit).where(LlmAudit.thread_id == trace_id).order_by(LlmAudit.id)))
        .scalars()
        .all()
    )
    spans = serialize_trace_spans(span_rows, llm_rows)
    usage = (
        await session.execute(
            select(
                func.coalesce(func.sum(LlmAudit.input_tokens), 0),
                func.coalesce(func.sum(LlmAudit.output_tokens), 0),
            ).where(LlmAudit.thread_id == trace_id)
        )
    ).one()
    model_name = (
        await session.execute(
            select(LlmAudit.model_name).where(LlmAudit.thread_id == trace_id).order_by(LlmAudit.id.desc()).limit(1)
        )
    ).scalar_one_or_none()
    await session.rollback()  # previews never retain KB inserts, cars, profile changes, or raw LLM audits
    trace = AiTrace(
        id=trace_id,
        thread_id=state["thread_id"],
        user_id=actor_id,
        query=payload.message,
        status="success",
        is_test=True,
        route=result.get("route"),
        model_name=model_name,
        input_tokens=int(usage[0] or 0),
        output_tokens=int(usage[1] or 0),
        duration_ms=int((perf_counter() - started) * 1000),
        configuration_version=f"preview:{str(payload.revision_id or runtime['version'])[:24]}",
        created_by=actor_id,
        updated_by=actor_id,
    )
    session.add(trace)
    await session.flush()
    for row in spans:
        session.add(
            AiTraceSpan(
                id=row["id"],
                trace_id=trace_id,
                sequence=row["sequence"],
                name=row["name"],
                kind=row["kind"],
                status=row["status"],
                duration_ms=row["duration_ms"],
                input_tokens=row["input_tokens"],
                output_tokens=row["output_tokens"],
                model_name=row["model_name"],
                details=row["details"],
            )
        )
    session.add(
        ConversationHistory(
            thread_id=state["thread_id"],
            checkpoint_id=str(uuid4()),
            user_id=actor_id,
            thread_type="admin-preview",
            checkpoint={
                "user": payload.message,
                "assistant": result.get("answer") or "",
                "trace_id": trace_id,
            },
            metadata_json={"title": payload.message[:80], "preview": True},
            created_by=actor_id,
            updated_by=actor_id,
        )
    )
    await session.commit()
    return {
        "trace_id": trace_id,
        "thread_id": state["thread_id"],
        "route": result.get("route"),
        "mode": result.get("mode"),
        "answer": result.get("answer"),
        "sources": result.get("sources", []),
        "steps": result.get("step", 0),
        "duration_ms": trace.duration_ms,
        "input_tokens": trace.input_tokens,
        "output_tokens": trace.output_tokens,
        "model_name": trace.model_name,
        "execution_flow": spans,
    }


@router.post("/administration/workflow/preview")
@log_flow(layer="route")
async def preview_workflow(
    payload: WorkflowPreviewRequest,
    actor: Profile = Depends(admin_profile),
    session: AsyncSession = Depends(get_session),
):
    workflow, runtime, actor_id, trace_id, started, state = await _prepare_preview(payload, actor.id, session)
    result = await main_agent(
        session,
        workflow_definition=workflow,
        prompt_overrides=runtime["prompts"],
        agent_profiles=runtime["agent_profiles"],
        prompt_version=f"preview:{str(payload.revision_id or runtime['version'])[:24]}",
        preview=True,
    ).ainvoke(state)
    return await _finalize_preview(session, payload, runtime, actor_id, trace_id, started, state, result)


@router.post("/administration/workflow/preview/stream")
async def stream_preview_workflow(
    payload: WorkflowPreviewRequest,
    actor: Profile = Depends(admin_profile),
):
    # Streaming outlives FastAPI's request dependency cleanup. Keep only the scalar actor id here and
    # own a dedicated database session for the full lifetime of the event stream.
    actor_id = actor.id

    async def stream():
        async with SessionFactory() as session:
            workflow, runtime, prepared_actor_id, trace_id, started, state = await _prepare_preview(
                payload, actor_id, session
            )
            events: asyncio.Queue[dict] = asyncio.Queue()
            task = asyncio.create_task(
                main_agent(
                    session,
                    workflow_definition=workflow,
                    prompt_overrides=runtime["prompts"],
                    agent_profiles=runtime["agent_profiles"],
                    prompt_version=f"preview:{str(payload.revision_id or runtime['version'])[:24]}",
                    preview=True,
                    trace_event_sink=events.put,
                ).ainvoke(state)
            )
            yield f"data: {json.dumps({'type': 'started', 'trace_id': trace_id, 'thread_id': state['thread_id']})}\n\n"
            try:
                while not task.done() or not events.empty():
                    try:
                        event = await asyncio.wait_for(events.get(), timeout=0.6)
                        yield f"data: {json.dumps({'type': 'step', 'span': event}, default=str)}\n\n"
                    except TimeoutError:
                        yield ": keep-alive\n\n"
                result = await task
                preview = await _finalize_preview(
                    session, payload, runtime, prepared_actor_id, trace_id, started, state, result
                )
                # Stream from the server so the UI renders the response progressively and never replays
                # a synthetic client-side animation after the request has already finished.
                answer = preview.get("answer") or ""
                for offset in range(0, len(answer), 22):
                    yield f"data: {json.dumps({'type': 'token', 'text': answer[offset : offset + 22]})}\n\n"
                    await asyncio.sleep(0.012)
                yield f"data: {json.dumps({'type': 'complete', 'result': preview}, default=str)}\n\n"
            except asyncio.CancelledError:
                task.cancel()
                await session.rollback()
                raise
            except Exception as exc:
                await session.rollback()
                yield f"data: {json.dumps({'type': 'error', 'message': str(exc)[:500]})}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
