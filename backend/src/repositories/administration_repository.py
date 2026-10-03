from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.schema import (
    AdministrationAuditEvent,
    AiTrace,
    AiTraceSpan,
    ConfigurationDefault,
    ConfigurationRevision,
    LlmAudit,
)
from src.utils.log_flow import log_flow


class AdministrationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @log_flow(layer="repository")
    async def latest(self, config_type: str, config_key: str, status: str | None = None) -> ConfigurationRevision | None:
        statement = select(ConfigurationRevision).where(
            ConfigurationRevision.config_type == config_type,
            ConfigurationRevision.config_key == config_key,
        )
        if status:
            statement = statement.where(ConfigurationRevision.status == status)
        return (await self.session.execute(statement.order_by(ConfigurationRevision.version.desc()).limit(1))).scalar_one_or_none()

    @log_flow(layer="repository")
    async def latest_developer(self, config_type: str, config_key: str) -> ConfigurationRevision | None:
        statement = select(ConfigurationRevision).where(
            ConfigurationRevision.config_type == config_type,
            ConfigurationRevision.config_key == config_key,
            ConfigurationRevision.created_by == "developer:startup",
        ).order_by(ConfigurationRevision.version.desc()).limit(1)
        return (await self.session.execute(statement)).scalar_one_or_none()

    @log_flow(layer="repository")
    async def by_id(self, revision_id: str) -> ConfigurationRevision | None:
        return await self.session.get(ConfigurationRevision, revision_id)

    @log_flow(layer="repository")
    async def by_version(self, config_type: str, config_key: str, version: int) -> ConfigurationRevision | None:
        return (await self.session.execute(select(ConfigurationRevision).where(
            ConfigurationRevision.config_type == config_type,
            ConfigurationRevision.config_key == config_key,
            ConfigurationRevision.version == version,
        ))).scalar_one_or_none()

    @log_flow(layer="repository")
    async def history(self, config_type: str, config_key: str, limit: int = 30) -> list[ConfigurationRevision]:
        rows = await self.session.execute(select(ConfigurationRevision).where(
            ConfigurationRevision.config_type == config_type,
            ConfigurationRevision.config_key == config_key,
        ).order_by(ConfigurationRevision.version.desc()).limit(limit))
        return list(rows.scalars())

    @log_flow(layer="repository")
    async def next_version(self, config_type: str, config_key: str) -> int:
        value = (await self.session.execute(select(func.max(ConfigurationRevision.version)).where(
            ConfigurationRevision.config_type == config_type,
            ConfigurationRevision.config_key == config_key,
        ))).scalar_one()
        return int(value or 0) + 1

    @log_flow(layer="repository")
    async def published_all(self) -> list[ConfigurationRevision]:
        rows = await self.session.execute(select(ConfigurationRevision).where(ConfigurationRevision.status == "published"))
        return list(rows.scalars())

    @log_flow(layer="repository")
    async def archive_drafts(self, config_type: str, config_key: str, actor_id: str) -> None:
        await self.session.execute(
            update(ConfigurationRevision)
            .where(
                ConfigurationRevision.config_type == config_type,
                ConfigurationRevision.config_key == config_key,
                ConfigurationRevision.status == "draft",
            )
            .values(status="archived", updated_by=actor_id)
        )

    @log_flow(layer="repository")
    async def audits(self, limit: int = 100) -> list[AdministrationAuditEvent]:
        rows = await self.session.execute(select(AdministrationAuditEvent).order_by(
            AdministrationAuditEvent.created_at.desc()
        ).limit(limit))
        return list(rows.scalars())

    @log_flow(layer="repository")
    async def default_pointer(self, config_type: str, config_key: str) -> ConfigurationDefault | None:
        statement = select(ConfigurationDefault).where(
            ConfigurationDefault.config_type == config_type,
            ConfigurationDefault.config_key == config_key,
        )
        return (await self.session.execute(statement)).scalar_one_or_none()

    @log_flow(layer="repository")
    async def traces(self, limit: int = 100) -> list[AiTrace]:
        rows = await self.session.execute(select(AiTrace).order_by(AiTrace.created_at.desc()).limit(limit))
        return list(rows.scalars())

    @log_flow(layer="repository")
    async def trace(self, trace_id: str) -> tuple[AiTrace | None, list[AiTraceSpan], list[LlmAudit]]:
        trace = await self.session.get(AiTrace, trace_id)
        if trace is None:
            return None, [], []
        rows = await self.session.execute(
            select(AiTraceSpan).where(AiTraceSpan.trace_id == trace_id).order_by(AiTraceSpan.sequence)
        )
        llm_rows = await self.session.execute(
            select(LlmAudit).where(LlmAudit.thread_id == trace_id).order_by(LlmAudit.id)
        )
        return trace, list(rows.scalars()), list(llm_rows.scalars())
