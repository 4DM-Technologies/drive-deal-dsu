from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from src.settings import DATA_DIRECTORY, UPLOAD_DIRECTORY, get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
engine = create_async_engine(settings.database_url, pool_pre_ping=True, echo=False)
SessionFactory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionFactory() as session:
        try:
            yield session
        finally:
            await session.close()


async def create_schema() -> None:
    from src.repositories.schema import tables  # noqa: F401

    DATA_DIRECTORY.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIRECTORY.mkdir(parents=True, exist_ok=True)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


async def dispose_engine() -> None:
    await engine.dispose()
