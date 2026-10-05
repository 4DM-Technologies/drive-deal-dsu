from contextlib import AsyncExitStack

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from src.settings import get_settings

_checkpointer: AsyncPostgresSaver | None = None
_stack: AsyncExitStack | None = None


def _psycopg_conninfo(database_url: str) -> str:
    return database_url.replace("postgresql+asyncpg://", "postgresql://").replace("?ssl=", "?sslmode=").replace("&ssl=", "&sslmode=")


async def init_checkpointer() -> AsyncPostgresSaver | None:
    """Starts a long-lived AsyncPostgresSaver for the app's lifetime - LangGraph's own checkpoint/store
    tables live in the same Postgres instance as everything else. No-op (graphs run without persistence)
    when DATABASE_URL isn't Postgres, e.g. local SQLite dev."""
    global _checkpointer, _stack
    database_url = get_settings().database_url
    if not database_url.startswith("postgresql"):
        return None
    _stack = AsyncExitStack()
    _checkpointer = await _stack.enter_async_context(AsyncPostgresSaver.from_conn_string(_psycopg_conninfo(database_url)))
    await _checkpointer.setup()
    return _checkpointer


async def close_checkpointer() -> None:
    global _checkpointer, _stack
    if _stack is not None:
        await _stack.aclose()
    _checkpointer = None
    _stack = None


def get_checkpointer() -> AsyncPostgresSaver | None:
    return _checkpointer
