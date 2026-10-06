import os
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from src.database import SessionFactory, create_schema, dispose_engine
from src.middleware.request_context import RequestContextMiddleware
from src.routes import (
    administration,
    ai,
    auth,
    cars,
    default,
    documents,
    marketplace,
    payment,
    profiles,
    reference,
    support,
    websocket,
)
from src.services.administration_service import AdministrationService
from src.settings import (
    API_CORS_HEADERS,
    API_CORS_METHODS,
    API_DESCRIPTION,
    API_EXPOSE_HEADERS,
    API_TITLE,
    API_VERSION,
    get_settings,
)
from src.utils.exceptions import AppError
from src.utils.exceptions.handlers import app_error_handler, unexpected_error_handler, validation_error_handler
from src.utils.log_flow import log_flow
from src.utils.logger import configure_logging, logger

settings = get_settings()

# Configured at import so router registration below emits the same JSON envelope as everything in
# lifespan. configure_logging() is idempotent, so the call inside lifespan stays as a safety net.
configure_logging()

ROUTER_MODULES = (
    auth,
    profiles,
    reference,
    marketplace,
    documents,
    cars,
    support,
    administration,
    ai,
    payment,
    websocket,
)


def database_driver() -> str:
    return settings.database_url.split("://", 1)[0] if "://" in settings.database_url else "unknown"


@log_flow(layer="service")
def log_startup_configuration() -> None:
    """One line describing the resolved environment; every credential is reported as a boolean."""
    logger.info(
        "startup_configuration",
        app_name=settings.app_name,
        app_env=settings.app_env,
        api_prefix=settings.api_prefix,
        database_driver=database_driver(),
        storage_driver=settings.storage_driver,
        ai_disabled=settings.ai_disabled,
        ai_provider=settings.ai_provider,
        ai_enable_web_search=settings.ai_enable_web_search,
        openai_model=settings.openai_model,
        openai_key_configured=bool(settings.openai_api_key),
        codex_token_configured=bool(settings.codex_oauth_access_token),
        google_search_configured=bool(settings.google_api_key and settings.google_cse_id),
        aws_region=settings.aws_region,
        aws_credentials_configured=bool(settings.aws_access_key_id and settings.aws_secret_access_key),
        s3_bucket=settings.s3_bucket if settings.storage_driver == "s3" else None,
        cors_origins=settings.cors_origins,
        log_level=settings.log_level,
        log_flow_enabled=settings.log_flow_enabled,
        jwt_secret_configured=bool(settings.jwt_secret_key),
        pid=os.getpid(),
    )


@log_flow(layer="service")
def _configure_langsmith() -> None:
    """Bridges our Pydantic Settings into the raw env vars langchain-core's callback system reads
    directly from os.environ — langsmith tracing activates automatically once these are set."""
    if not (settings.langsmith_tracing and settings.langsmith_api_key):
        logger.info("langsmith_tracing_disabled", reason="langsmith_tracing or langsmith_api_key is not set")
        return
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_API_KEY"] = settings.langsmith_api_key
    os.environ["LANGCHAIN_PROJECT"] = settings.langsmith_project
    if settings.langsmith_endpoint:
        os.environ["LANGCHAIN_ENDPOINT"] = settings.langsmith_endpoint
    logger.info("langsmith_tracing_enabled", project=settings.langsmith_project)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Emits the full startup and shutdown lifecycle so a bad boot shows up in the log, not a blank terminal."""
    started_at = time.perf_counter()
    logger.info("app_starting", app_env=settings.app_env, api_prefix=settings.api_prefix)
    configure_logging()
    log_startup_configuration()
    _configure_langsmith()
    try:
        await create_schema()
        logger.info("database_ready", driver=database_driver())
        async with SessionFactory() as session:
            synced = await AdministrationService(session).sync_code_baselines()
            logger.info("developer_configuration_synced", revision_count=len(synced))
        logger.info("app_ready", startup_duration_ms=round((time.perf_counter() - started_at) * 1000, 3))
        yield
    except Exception as exc:
        logger.exception(
            "app_startup_failed",
            duration_ms=round((time.perf_counter() - started_at) * 1000, 3),
            error_type=type(exc).__name__,
            error=str(exc),
        )
        raise
    finally:
        logger.info("app_shutting_down", uptime_ms=round((time.perf_counter() - started_at) * 1000, 3))
        await dispose_engine()


app = FastAPI(
    title=API_TITLE,
    version=API_VERSION,
    description=API_DESCRIPTION,
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
    allow_methods=list(API_CORS_METHODS),
    allow_headers=list(API_CORS_HEADERS),
    expose_headers=list(API_EXPOSE_HEADERS),
)
app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)
app.add_exception_handler(Exception, unexpected_error_handler)

app.include_router(default.router, prefix=settings.api_prefix)
for route_module in ROUTER_MODULES:
    app.include_router(route_module.router, prefix=settings.api_prefix)

logger.info(
    "routers_registered",
    prefix=settings.api_prefix,
    modules=[module.__name__.rsplit(".", 1)[-1] for module in (default, *ROUTER_MODULES)],
    route_count=len(app.routes),
)
