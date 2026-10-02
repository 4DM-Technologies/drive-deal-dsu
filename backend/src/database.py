from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from src.settings import DATA_DIRECTORY, UPLOAD_DIRECTORY, get_settings
from src.utils.log_flow import log_flow
from src.utils.logger import logger


class Base(DeclarativeBase):
    pass


settings = get_settings()
engine = create_async_engine(settings.database_url, pool_pre_ping=True, echo=False)
SessionFactory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@log_flow(layer="middleware")
async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionFactory() as session:
        try:
            yield session
        finally:
            await session.close()


@log_flow(layer="service")
async def create_schema() -> None:
    from src.repositories.schema import tables  # noqa: F401

    if settings.storage_driver == "local":
        DATA_DIRECTORY.mkdir(parents=True, exist_ok=True)
        UPLOAD_DIRECTORY.mkdir(parents=True, exist_ok=True)
        logger.info("storage_directories_ready", data_directory=str(DATA_DIRECTORY), upload_directory=str(UPLOAD_DIRECTORY))
    logger.info("schema_creation_started", dialect=engine.dialect.name, table_count=len(Base.metadata.tables))
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    logger.info("schema_creation_completed", table_count=len(Base.metadata.tables))


@log_flow(layer="service")
async def dispose_engine() -> None:
    await engine.dispose()
    logger.info("engine_disposed")