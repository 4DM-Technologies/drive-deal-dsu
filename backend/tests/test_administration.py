from copy import deepcopy
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError
from sqlalchemy import delete, update

from src.agents.configuration import default_theme, default_workflow
from src.database import SessionFactory
from src.models.administration import WorkflowPreviewRequest
from src.repositories.schema import AdministrationAuditEvent, AiTraceSpan, ConfigurationRevision, LlmAudit
from src.routes.administration import _prepare_preview
from src.services.administration_service import AdministrationService, serialize_trace_spans
from src.utils.exceptions import AppError


def test_workflow_preview_thread_id_is_optional_and_safe() -> None:
    assert WorkflowPreviewRequest(message="Hello").thread_id is None
    assert WorkflowPreviewRequest(message="Hello", thread_id="preview:buyer-42").thread_id == "preview:buyer-42"

    with pytest.raises(ValidationError):
        WorkflowPreviewRequest(message="Hello", thread_id="thread id with spaces")


async def test_prepare_preview_namespaces_thread_and_builds_state() -> None:
    payload = WorkflowPreviewRequest(
        message="Compare two compact SUVs",
        thread_id="comparison-session",
        workflow_payload=default_workflow(),
    )

    async with SessionFactory() as session:
        workflow, runtime, actor_id, trace_id, _, state = await _prepare_preview(
            payload,
            "pytest-preview-admin",
            session,
        )
        assert workflow["name"] == default_workflow()["name"]
        assert runtime["version"]
        assert actor_id == "pytest-preview-admin"
        assert trace_id == state["trace_id"]
        assert state["thread_id"].startswith("admin-preview-pytest-p-")
        assert len(state["thread_id"]) <= 80
        assert state["conversation_context"] == []
        assert state["preview"] is True
        await session.rollback()


def test_default_workflow_is_valid_and_unknown_code_is_rejected() -> None:
    workflow = default_workflow()
    assert AdministrationService.validate_payload("workflow", "sera-main", workflow) == []

    workflow["nodes"][0]["id"] = "arbitrary_python"
    errors = AdministrationService.validate_payload("workflow", "sera-main", workflow)
    assert any("Unknown executable nodes" in error for error in errors)


def test_workflow_cycle_and_low_contrast_theme_are_rejected() -> None:
    workflow = default_workflow()
    compose_edge = next(edge for edge in workflow["edges"] if edge["source"] == "compose")
    compose_edge["target"] = "triage"
    assert any(
        "cycles are disabled" in error
        for error in AdministrationService.validate_payload("workflow", "sera-main", workflow)
    )

    theme = default_theme()
    theme["primary_rgb"] = [245, 245, 245]
    assert any("contrast" in error for error in AdministrationService.validate_payload("theme", "global", theme))


def test_legacy_llm_audits_are_serialized_as_trace_handoffs() -> None:
    created_at = datetime.now(UTC)
    audit = LlmAudit(
        uuid="llm-1",
        task_type="classifier",
        provider="openai",
        model_name="gpt-6-luna",
        thread_id="trace-1",
        input_tokens=80,
        output_tokens=20,
        total_tokens=100,
        latency_ms=125,
        status="success",
        prompt_version="v1",
        created_at=created_at,
        updated_at=created_at,
    )

    timeline = serialize_trace_spans([], [audit])

    assert timeline[0]["sequence"] == 1
    assert timeline[0]["kind"] == "llm"
    assert timeline[0]["details"]["legacy_record"] is True
    assert timeline[0]["details"]["next_step"] == "response"


def test_native_llm_spans_take_precedence_over_legacy_audits() -> None:
    created_at = datetime.now(UTC)
    span = AiTraceSpan(
        id="span-1",
        trace_id="trace-1",
        sequence=7,
        name="compose",
        kind="llm",
        status="success",
        duration_ms=75,
        input_tokens=40,
        output_tokens=15,
        model_name="gpt-6-luna",
        details={"llm_called": True},
        created_at=created_at,
    )
    audit = LlmAudit(
        uuid="legacy-ignored",
        task_type="compose",
        provider="openai",
        model_name="gpt-6-luna",
        thread_id="trace-1",
        input_tokens=40,
        output_tokens=15,
        total_tokens=55,
        latency_ms=75,
        status="success",
        prompt_version="v1",
        created_at=created_at,
        updated_at=created_at,
    )

    timeline = serialize_trace_spans([span], [audit])

    assert [item["id"] for item in timeline] == ["span-1"]
    assert timeline[0]["sequence"] == 1
    assert timeline[0]["details"]["next_step"] == "response"


def test_configuration_validation_and_normalization_cover_each_surface() -> None:
    with pytest.raises(AppError) as error:
        AdministrationService._default_payload("unknown", "unknown")
    assert error.value.status_code == 404

    assert AdministrationService.validate_payload("prompt", "unknown", {}) == ["Unknown prompt key."]
    invalid_prompt = {
        "content": "A sufficiently long prompt for validation.",
        "model": "unapproved-model",
        "reasoning_effort": "medium",
        "max_output_tokens": 512,
    }
    assert AdministrationService.validate_payload("prompt", "main_agent", invalid_prompt) == [
        "Select a model from the approved runtime catalog."
    ]
    assert AdministrationService.validate_payload("workflow", "sera-main", {})
    assert AdministrationService.validate_payload("unsupported", "anything", {}) == ["Unsupported configuration type."]

    workflow = default_workflow()
    theme = default_theme()
    prompt = {**invalid_prompt, "model": "gpt-6-luna"}
    assert AdministrationService._normalize_payload("workflow", workflow)["name"] == workflow["name"]
    assert AdministrationService._normalize_payload("theme", theme)["primary_rgb"] == theme["primary_rgb"]
    assert AdministrationService._normalize_payload("prompt", prompt)["model"] == "gpt-6-luna"


async def test_draft_publish_and_rollback_are_versioned_and_audited() -> None:
    async with SessionFactory() as session:
        service = AdministrationService(session)
        test_actors = {"test-admin", "pytest:test-admin"}
        original = await service.repository.latest("theme", "global", "published")
        if original and original.created_by in test_actors:
            original = await service.repository.latest_developer("theme", "global")
        await session.execute(
            delete(AdministrationAuditEvent).where(AdministrationAuditEvent.actor_id.in_(test_actors))
        )
        await session.execute(delete(ConfigurationRevision).where(ConfigurationRevision.created_by.in_(test_actors)))
        if original:
            await session.execute(
                update(ConfigurationRevision)
                .where(
                    ConfigurationRevision.config_type == "theme",
                    ConfigurationRevision.config_key == "global",
                    ConfigurationRevision.status == "published",
                )
                .values(status="archived")
            )
            original.status = "published"
        await session.commit()

        before_audits = len(await service.audit_history(250))
        active_version = (await service.config_bundle("theme", "global"))["active"]["version"]
        theme = deepcopy(default_theme())
        theme["name"] = "Operations blue"
        try:
            draft = await service.save_draft("theme", "global", theme, "pytest:test-admin", active_version)
            assert draft["status"] == "draft"

            published = await service.publish("theme", "global", draft["id"], "pytest:test-admin")
            assert published["status"] == "published"
            assert (await service.active_theme())["name"] == "Operations blue"

            restored = await service.rollback("theme", "global", published["version"], "pytest:test-admin")
            assert restored["version"] > published["version"]
            assert restored["status"] == "published"
            assert len(await service.audit_history(250)) == before_audits + 3
        finally:
            await session.execute(
                delete(AdministrationAuditEvent).where(AdministrationAuditEvent.actor_id == "pytest:test-admin")
            )
            await session.execute(
                delete(ConfigurationRevision).where(ConfigurationRevision.created_by == "pytest:test-admin")
            )
            if original:
                await session.execute(
                    update(ConfigurationRevision)
                    .where(
                        ConfigurationRevision.config_type == "theme",
                        ConfigurationRevision.config_key == "global",
                        ConfigurationRevision.status == "published",
                    )
                    .values(status="archived")
                )
                await session.execute(
                    update(ConfigurationRevision)
                    .where(ConfigurationRevision.id == original.id)
                    .values(status="published")
                )
            await session.commit()


async def test_optimistic_concurrency_prevents_stale_draft() -> None:
    async with SessionFactory() as session:
        service = AdministrationService(session)
        with pytest.raises(AppError) as error:
            await service.save_draft("theme", "global", default_theme(), "test-admin", 99)
        assert error.value.status_code == 409
