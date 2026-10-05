import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.agents.configuration import (
    AGENT_MAX_OUTPUT_TOKENS,
    CONDITIONS_BY_SOURCE,
    MODEL_CATALOG,
    NODE_CATALOG,
    PROMPT_CATALOG,
    THEME_KEY,
    WORKFLOW_KEY,
    default_theme,
    default_workflow,
    prompt_file_for,
)
from src.agents.prompts import PROMPT_ROOT
from src.models.administration import PromptDefinition, ThemeDefinition, WorkflowDefinition
from src.repositories.administration_repository import AdministrationRepository
from src.repositories.schema import AdministrationAuditEvent, ConfigurationDefault, ConfigurationRevision
from src.settings import get_settings
from src.utils.exceptions import AppError, error_codes
from src.utils.log_flow import log_flow
from src.utils.serialization import model_dict


def serialize_trace_spans(spans: list, llm_calls: list) -> list[dict[str, Any]]:
    """Merge graph spans and LLM calls into one chronological, hand-off-aware execution timeline."""
    serialized = [model_dict(span) for span in spans]
    has_native_llm_spans = any(item.get("kind") == "llm" for item in serialized)
    serialized.extend(
        {
            "id": row.uuid,
            "trace_id": row.thread_id,
            "sequence": 0,
            "name": row.task_type,
            "kind": "llm",
            "status": row.status,
            "duration_ms": row.latency_ms,
            "input_tokens": row.input_tokens,
            "output_tokens": row.output_tokens,
            "model_name": row.model_name,
            "details": {
                "provider": row.provider,
                "prompt_version": row.prompt_version,
                "llm_called": True,
                "legacy_record": True,
            },
            "created_at": row.created_at,
        }
        for row in ([] if has_native_llm_spans else llm_calls)
    )
    serialized.sort(key=lambda item: (str(item.get("created_at") or ""), 0 if item.get("kind") != "llm" else 1))
    for index, item in enumerate(serialized, start=1):
        item["sequence"] = index
        item.setdefault("details", {})["next_step"] = (
            serialized[index]["name"] if index < len(serialized) else "response"
        )
    return serialized


class AdministrationService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repository = AdministrationRepository(session)

    @staticmethod
    def _checksum(payload: dict[str, Any]) -> str:
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
        return hashlib.sha256(encoded).hexdigest()

    @staticmethod
    def _revision_dict(row: ConfigurationRevision) -> dict[str, Any]:
        return model_dict(row)

    @staticmethod
    def _default_payload(config_type: str, config_key: str) -> dict[str, Any]:
        if config_type == "workflow" and config_key == WORKFLOW_KEY:
            return default_workflow()
        if config_type == "theme" and config_key == THEME_KEY:
            return default_theme()
        if config_type == "prompt":
            filename = prompt_file_for(config_key)
            if filename:
                settings = get_settings()
                return {
                    "content": (PROMPT_ROOT / filename).read_text(encoding="utf-8"),
                    "model": settings.openai_model,
                    "reasoning_effort": settings.openai_reasoning_effort,
                    "max_output_tokens": settings.ai_max_output_tokens,
                }
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "Configuration not found.", 404)

    @classmethod
    def _virtual_default(cls, config_type: str, config_key: str) -> dict[str, Any]:
        payload = cls._default_payload(config_type, config_key)
        return {
            "id": f"default:{config_type}:{config_key}",
            "config_type": config_type,
            "config_key": config_key,
            "version": 0,
            "status": "published",
            "payload": payload,
            "checksum": cls._checksum(payload),
            "published_at": None,
            "published_by": "system",
            "created_at": None,
            "updated_at": None,
            "created_by": "system",
            "updated_by": "system",
        }

    @staticmethod
    def _relative_luminance(rgb: list[int]) -> float:
        channels = []
        for component in rgb:
            channel = component / 255
            channels.append(channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4)
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]

    @classmethod
    def _contrast_with_white(cls, rgb: list[int]) -> float:
        luminance = cls._relative_luminance(rgb)
        return 1.05 / (luminance + 0.05)

    @classmethod
    def validate_payload(cls, config_type: str, config_key: str, payload: dict[str, Any]) -> list[str]:
        try:
            if config_type == "workflow":
                definition = WorkflowDefinition.model_validate(payload)
                return cls._validate_workflow(definition)
            if config_type == "prompt":
                if prompt_file_for(config_key) is None:
                    return ["Unknown prompt key."]
                prompt = PromptDefinition.model_validate(payload)
                allowed_models = {item["id"] for item in MODEL_CATALOG}
                if prompt.model not in allowed_models:
                    return ["Select a model from the approved runtime catalog."]
                return []
            if config_type == "theme":
                if config_key != THEME_KEY:
                    return ["Unknown theme key."]
                theme = ThemeDefinition.model_validate(payload)
                contrast = cls._contrast_with_white(theme.primary_rgb)
                errors = (
                    []
                    if contrast >= 4.5
                    else [
                        f"Primary color needs at least 4.5:1 contrast with white text; current contrast is {contrast:.2f}:1."
                    ]
                )
                text_luminance = cls._relative_luminance(theme.text_rgb)
                for label, color in (("page background", theme.background_rgb), ("surface", theme.surface_rgb)):
                    background_luminance = cls._relative_luminance(color)
                    ratio = (max(text_luminance, background_luminance) + 0.05) / (
                        min(text_luminance, background_luminance) + 0.05
                    )
                    if ratio < 4.5:
                        errors.append(
                            f"Text and {label} need at least 4.5:1 contrast; current contrast is {ratio:.2f}:1."
                        )
                return errors
        except ValidationError as exc:
            return [error["msg"] for error in exc.errors()]
        return ["Unsupported configuration type."]

    @staticmethod
    def _normalize_payload(config_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        if config_type == "workflow":
            return WorkflowDefinition.model_validate(payload).model_dump()
        if config_type == "prompt":
            return PromptDefinition.model_validate(payload).model_dump()
        if config_type == "theme":
            return ThemeDefinition.model_validate(payload).model_dump()
        return payload

    @staticmethod
    def _validate_workflow(definition: WorkflowDefinition) -> list[str]:
        errors: list[str] = []
        allowed_nodes = {item["id"] for item in NODE_CATALOG}
        node_ids = [node.id for node in definition.nodes]
        edge_ids = [edge.id for edge in definition.edges]
        if len(node_ids) != len(set(node_ids)):
            errors.append("Every workflow node ID must be unique.")
        if len(edge_ids) != len(set(edge_ids)):
            errors.append("Every workflow connection ID must be unique.")
        unknown = set(node_ids) - allowed_nodes
        missing = allowed_nodes - set(node_ids)
        if unknown:
            errors.append(f"Unknown executable nodes: {', '.join(sorted(unknown))}.")
        if missing:
            errors.append(f"Required safe nodes are missing: {', '.join(sorted(missing))}.")

        target_ids = set(node_ids) | {"end"}
        seen_conditions: set[tuple[str, str]] = set()
        adjacency: dict[str, set[str]] = {"start": set(), **{node_id: set() for node_id in node_ids}}
        for edge in definition.edges:
            if edge.source not in adjacency:
                errors.append(f"Connection {edge.id} has unknown source {edge.source}.")
                continue
            if edge.target not in target_ids:
                errors.append(f"Connection {edge.id} has unknown target {edge.target}.")
                continue
            allowed_conditions = CONDITIONS_BY_SOURCE.get(edge.source, set())
            if edge.condition not in allowed_conditions:
                errors.append(
                    f"Connection {edge.id} uses condition {edge.condition!r}, which {edge.source} does not support."
                )
            condition_key = (edge.source, edge.condition)
            if condition_key in seen_conditions:
                errors.append(f"{edge.source} has more than one {edge.condition!r} connection.")
            seen_conditions.add(condition_key)
            adjacency[edge.source].add(edge.target)

        for source, conditions in CONDITIONS_BY_SOURCE.items():
            for condition in conditions:
                if (source, condition) not in seen_conditions:
                    errors.append(f"{source} needs a {condition!r} connection.")

        reachable: set[str] = set()
        stack = ["start"]
        while stack:
            current = stack.pop()
            if current in reachable:
                continue
            reachable.add(current)
            stack.extend(adjacency.get(current, set()) - reachable)
        if "end" not in reachable:
            errors.append("The workflow must have a path from Start to End.")
        unreachable = set(node_ids) - reachable
        if unreachable:
            errors.append(f"Unreachable nodes: {', '.join(sorted(unreachable))}.")

        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(node_id: str) -> bool:
            if node_id == "end":
                return False
            if node_id in visiting:
                return True
            if node_id in visited:
                return False
            visiting.add(node_id)
            if any(visit(target) for target in adjacency.get(node_id, set())):
                return True
            visiting.remove(node_id)
            visited.add(node_id)
            return False

        if visit("start"):
            errors.append("Workflow cycles are disabled because they can create unbounded agent runs.")
        return errors

    @log_flow(layer="service")
    async def config_bundle(self, config_type: str, config_key: str) -> dict[str, Any]:
        self._default_payload(config_type, config_key)  # validates the key before querying
        active = await self.repository.latest(config_type, config_key, "published")
        draft = await self.repository.latest(config_type, config_key, "draft")
        history = await self.repository.history(config_type, config_key)
        pointer = await self.repository.default_pointer(config_type, config_key)
        return {
            "active": self._revision_dict(active) if active else self._virtual_default(config_type, config_key),
            "draft": self._revision_dict(draft) if draft else None,
            "history": [self._revision_dict(row) for row in history],
            "default_version": pointer.version if pointer else 0,
        }

    @log_flow(layer="service")
    async def save_draft(
        self,
        config_type: str,
        config_key: str,
        payload: dict[str, Any],
        actor_id: str,
        base_version: int | None,
    ) -> dict[str, Any]:
        errors = self.validate_payload(config_type, config_key, payload)
        if errors:
            raise AppError(error_codes.VALIDATION_ERROR, "Configuration validation failed.", 422, {"errors": errors})
        payload = self._normalize_payload(config_type, payload)
        active = await self.repository.latest(config_type, config_key, "published")
        active_version = active.version if active else 0
        if base_version is not None and base_version != active_version:
            raise AppError(
                error_codes.CONFLICT, "A newer version is already active. Reload before saving this draft.", 409
            )
        await self.repository.archive_drafts(config_type, config_key, actor_id)
        revision = ConfigurationRevision(
            config_type=config_type,
            config_key=config_key,
            version=await self.repository.next_version(config_type, config_key),
            status="draft",
            payload=payload,
            checksum=self._checksum(payload),
            created_by=actor_id,
            updated_by=actor_id,
        )
        self.session.add(revision)
        await self.session.flush()
        self._audit("draft_saved", revision, actor_id, {"base_version": active_version})
        await self.session.commit()
        await self.session.refresh(revision)
        return self._revision_dict(revision)

    @log_flow(layer="service")
    async def publish(self, config_type: str, config_key: str, revision_id: str, actor_id: str) -> dict[str, Any]:
        revision = await self.repository.by_id(revision_id)
        if revision is None or revision.config_type != config_type or revision.config_key != config_key:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Draft revision not found.", 404)
        if revision.status != "draft":
            raise AppError(error_codes.ILLEGAL_TRANSITION, "Only a draft revision can be published.", 422)
        errors = self.validate_payload(config_type, config_key, revision.payload)
        if errors:
            raise AppError(error_codes.VALIDATION_ERROR, "Configuration validation failed.", 422, {"errors": errors})
        active = await self.repository.latest(config_type, config_key, "published")
        if active:
            active.status = "archived"
            active.updated_by = actor_id
            await self.session.flush()
        revision.status = "published"
        revision.published_at = datetime.now(UTC)
        revision.published_by = actor_id
        revision.updated_by = actor_id
        self._audit("published", revision, actor_id, {"replaced_version": active.version if active else 0})
        await self.session.commit()
        await self.session.refresh(revision)
        return self._revision_dict(revision)

    @log_flow(layer="service")
    async def rollback(self, config_type: str, config_key: str, version: int, actor_id: str) -> dict[str, Any]:
        source = await self.repository.by_version(config_type, config_key, version)
        if source is None:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Revision not found.", 404)
        active = await self.repository.latest(config_type, config_key, "published")
        if active:
            active.status = "archived"
            active.updated_by = actor_id
            await self.session.flush()
        await self.repository.archive_drafts(config_type, config_key, actor_id)
        restored = ConfigurationRevision(
            config_type=config_type,
            config_key=config_key,
            version=await self.repository.next_version(config_type, config_key),
            status="published",
            payload=source.payload,
            checksum=source.checksum,
            published_at=datetime.now(UTC),
            published_by=actor_id,
            created_by=actor_id,
            updated_by=actor_id,
        )
        self.session.add(restored)
        await self.session.flush()
        self._audit("rolled_back", restored, actor_id, {"source_version": version})
        await self.session.commit()
        await self.session.refresh(restored)
        return self._revision_dict(restored)

    @log_flow(layer="service")
    async def set_default(self, config_type: str, config_key: str, version: int, actor_id: str) -> dict[str, Any]:
        if version == 0:
            self._default_payload(config_type, config_key)
        elif await self.repository.by_version(config_type, config_key, version) is None:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Revision not found.", 404)
        pointer = await self.repository.default_pointer(config_type, config_key)
        if pointer is None:
            pointer = ConfigurationDefault(
                config_type=config_type,
                config_key=config_key,
                version=version,
                created_by=actor_id,
                updated_by=actor_id,
            )
            self.session.add(pointer)
        else:
            pointer.version = version
            pointer.updated_by = actor_id
        self.session.add(
            AdministrationAuditEvent(
                action="default_selected",
                resource_type=config_type,
                resource_key=config_key,
                revision_id=None,
                actor_id=actor_id,
                details={"version": version},
            )
        )
        await self.session.commit()
        return {"config_type": config_type, "config_key": config_key, "default_version": version}

    @log_flow(layer="service")
    async def reset_to_default(self, config_type: str, config_key: str, actor_id: str) -> dict[str, Any]:
        pointer = await self.repository.default_pointer(config_type, config_key)
        return (
            await self.rollback(config_type, config_key, pointer.version if pointer else 0, actor_id)
            if pointer and pointer.version
            else await self._publish_builtin_default(config_type, config_key, actor_id)
        )

    async def _publish_builtin_default(self, config_type: str, config_key: str, actor_id: str) -> dict[str, Any]:
        active = await self.repository.latest(config_type, config_key, "published")
        if active:
            active.status = "archived"
            active.updated_by = actor_id
            await self.session.flush()
        payload = self._default_payload(config_type, config_key)
        revision = ConfigurationRevision(
            config_type=config_type,
            config_key=config_key,
            version=await self.repository.next_version(config_type, config_key),
            status="published",
            payload=payload,
            checksum=self._checksum(payload),
            published_at=datetime.now(UTC),
            published_by=actor_id,
            created_by=actor_id,
            updated_by=actor_id,
        )
        self.session.add(revision)
        await self.session.flush()
        self._audit("reset_to_default", revision, actor_id, {"source_version": 0})
        await self.session.commit()
        return self._revision_dict(revision)

    @log_flow(layer="service")
    async def sync_code_baselines(self) -> list[dict[str, Any]]:
        """Publish changed developer defaults on startup, preserving all earlier versions for rollback."""
        if self.session.bind and self.session.bind.dialect.name == "postgresql":
            await self.session.execute(text("SELECT pg_advisory_xact_lock(93821473)"))
        configurations = [("workflow", WORKFLOW_KEY), ("theme", THEME_KEY)] + [
            ("prompt", item["key"]) for item in PROMPT_CATALOG
        ]
        synced: list[dict[str, Any]] = []
        for config_type, config_key in configurations:
            payload = self._default_payload(config_type, config_key)
            checksum = self._checksum(payload)
            latest_developer = await self.repository.latest_developer(config_type, config_key)
            if latest_developer and latest_developer.checksum == checksum:
                continue
            active = await self.repository.latest(config_type, config_key, "published")
            if active:
                active.status = "archived"
                active.updated_by = "developer:startup"
                await self.session.flush()
            await self.repository.archive_drafts(config_type, config_key, "developer:startup")
            revision = ConfigurationRevision(
                config_type=config_type,
                config_key=config_key,
                version=await self.repository.next_version(config_type, config_key),
                status="published",
                payload=payload,
                checksum=checksum,
                published_at=datetime.now(UTC),
                published_by="developer:startup",
                created_by="developer:startup",
                updated_by="developer:startup",
            )
            self.session.add(revision)
            await self.session.flush()
            pointer = await self.repository.default_pointer(config_type, config_key)
            if pointer is None:
                pointer = ConfigurationDefault(
                    config_type=config_type,
                    config_key=config_key,
                    version=revision.version,
                    created_by="developer:startup",
                    updated_by="developer:startup",
                )
                self.session.add(pointer)
            else:
                pointer.version = revision.version
                pointer.updated_by = "developer:startup"
            self._audit("developer_version_published", revision, "developer:startup", {"source": "code"})
            synced.append(self._revision_dict(revision))
        await self.session.commit()
        return synced

    def _audit(self, action: str, revision: ConfigurationRevision, actor_id: str, details: dict[str, Any]) -> None:
        self.session.add(
            AdministrationAuditEvent(
                action=action,
                resource_type=revision.config_type,
                resource_key=revision.config_key,
                revision_id=revision.id,
                actor_id=actor_id,
                details={**details, "version": revision.version, "checksum": revision.checksum},
            )
        )

    @log_flow(layer="service")
    async def prompt_bundles(self) -> list[dict[str, Any]]:
        result = []
        for item in PROMPT_CATALOG:
            result.append({**item, **await self.config_bundle("prompt", item["key"])})
        return result

    @log_flow(layer="service")
    async def audit_history(self, limit: int = 100) -> list[dict[str, Any]]:
        return [model_dict(row) for row in await self.repository.audits(min(max(limit, 1), 250))]

    @log_flow(layer="service")
    async def trace_history(self, limit: int = 100) -> list[dict[str, Any]]:
        return [model_dict(row) for row in await self.repository.traces(min(max(limit, 1), 250))]

    @log_flow(layer="service")
    async def trace_detail(self, trace_id: str) -> dict[str, Any]:
        trace, spans, llm_calls = await self.repository.trace(trace_id)
        if trace is None:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "AI trace not found.", 404)
        return {**model_dict(trace), "spans": serialize_trace_spans(spans, llm_calls)}

    @log_flow(layer="service")
    async def export_snapshot(self) -> dict[str, Any]:
        """Return the complete active, non-secret control-plane state for Git or AI-assisted development."""
        rows = await self.repository.published_all()
        active = {(row.config_type, row.config_key): row for row in rows}
        workflow = active.get(("workflow", WORKFLOW_KEY))
        theme = active.get(("theme", THEME_KEY))
        prompts = []
        for item in PROMPT_CATALOG:
            row = active.get(("prompt", item["key"]))
            revision = self._revision_dict(row) if row else self._virtual_default("prompt", item["key"])
            prompts.append(
                {
                    "key": item["key"],
                    "label": item["label"],
                    "description": item["description"],
                    "source_file": item["file"],
                    "version": revision["version"],
                    **revision["payload"],
                }
            )
        workflow_revision = (
            self._revision_dict(workflow) if workflow else self._virtual_default("workflow", WORKFLOW_KEY)
        )
        theme_revision = self._revision_dict(theme) if theme else self._virtual_default("theme", THEME_KEY)
        return {
            "schema_version": 1,
            "exported_at": datetime.now(UTC).isoformat(),
            "application": "Deal&Drive",
            "notes": "Repository-safe active configuration. Credentials and secrets are never included.",
            "workflow": {"key": WORKFLOW_KEY, "version": workflow_revision["version"], **workflow_revision["payload"]},
            "theme": {"key": THEME_KEY, "version": theme_revision["version"], **theme_revision["payload"]},
            "agents_and_prompts": prompts,
            "catalog": {"models": MODEL_CATALOG, "nodes": NODE_CATALOG},
        }

    @log_flow(layer="service")
    async def active_theme(self) -> dict[str, Any]:
        row = await self.repository.latest("theme", THEME_KEY, "published")
        revision = self._revision_dict(row) if row else self._virtual_default("theme", THEME_KEY)
        return {"version": revision["version"], **revision["payload"]}

    @log_flow(layer="service")
    async def runtime_bundle(self) -> dict[str, Any]:
        rows = await self.repository.published_all()
        active = {(row.config_type, row.config_key): row for row in rows}
        workflow_row = active.get(("workflow", WORKFLOW_KEY))
        prompts: dict[str, str] = {}
        agent_profiles: dict[str, dict[str, Any]] = {}
        versions: list[str] = []
        if workflow_row:
            versions.append(f"workflow:{workflow_row.version}")
        for item in PROMPT_CATALOG:
            row = active.get(("prompt", item["key"]))
            if row:
                prompts[item["key"]] = str(row.payload["content"])
                agent_profiles[item["key"]] = {
                    "model": row.payload.get("model", get_settings().openai_model),
                    "reasoning_effort": row.payload.get("reasoning_effort", get_settings().openai_reasoning_effort),
                    "max_output_tokens": row.payload.get(
                        "max_output_tokens",
                        AGENT_MAX_OUTPUT_TOKENS.get(item["key"], get_settings().ai_max_output_tokens),
                    ),
                }
                versions.append(f"{item['key']}:{row.version}")
        version_manifest = ",".join(versions)
        runtime_version = f"cfg:{hashlib.sha256(version_manifest.encode()).hexdigest()[:16]}" if versions else "default"
        return {
            "workflow": workflow_row.payload if workflow_row else default_workflow(),
            "prompts": prompts,
            "agent_profiles": agent_profiles,
            "version": runtime_version,
        }

    @log_flow(layer="service")
    async def workflow_for_revision(self, revision_id: str | None) -> dict[str, Any]:
        if not revision_id:
            row = await self.repository.latest("workflow", WORKFLOW_KEY, "published")
            return row.payload if row else default_workflow()
        row = await self.repository.by_id(revision_id)
        if row is None or row.config_type != "workflow" or row.config_key != WORKFLOW_KEY:
            raise AppError(error_codes.RESOURCE_NOT_FOUND, "Workflow revision not found.", 404)
        errors = self.validate_payload("workflow", WORKFLOW_KEY, row.payload)
        if errors:
            raise AppError(error_codes.VALIDATION_ERROR, "Workflow validation failed.", 422, {"errors": errors})
        return row.payload
