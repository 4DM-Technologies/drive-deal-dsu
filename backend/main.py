import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from src.database import create_schema, dispose_engine
from src.middleware.request_context import RequestContextMiddleware
from src.routes import ai, auth, cars, default, documents, marketplace, profiles, reference, support, websocket
from src.seed import seed_database
from src.settings import get_settings
from src.utils.exceptions import AppError
from src.utils.exceptions.handlers import app_error_handler, unexpected_error_handler, validation_error_handler
from src.utils.logger import configure_logging, logger

settings = get_settings()


def _configure_langsmith() -> None:
    """Bridges our Pydantic Settings into the raw env vars langchain-core's callback system reads
    directly from os.environ — langsmith tracing activates automatically once these are set."""
    if not (settings.langsmith_tracing and settings.langsmith_api_key):
        return
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_API_KEY"] = settings.langsmith_api_key
    os.environ["LANGCHAIN_PROJECT"] = settings.langsmith_project
    if settings.langsmith_endpoint:
        os.environ["LANGCHAIN_ENDPOINT"] = settings.langsmith_endpoint
    logger.info("langsmith_tracing_enabled", project=settings.langsmith_project)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    _configure_langsmith()
    await create_schema()
    if settings.auto_seed_demo:
        await seed_database()
    yield
    await dispose_engine()


app = FastAPI(
    title="DriveDeal API",
    version="1.0.0",
    description="Reverse vehicle marketplace and Serra buyer advisor API.",
    docs_url=f"{settings.api_prefix}/docs",
    openapi_url=f"{settings.api_prefix}/openapi.json",
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)
app.add_exception_handler(Exception, unexpected_error_handler)

app.include_router(default.router, prefix=settings.api_prefix)
for route_module in (auth, profiles, reference, marketplace, documents, cars, support, ai, websocket):
    app.include_router(route_module.router, prefix=settings.api_prefix)
