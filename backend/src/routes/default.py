from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.settings import get_settings
from src.utils.log_flow import log_flow

router = APIRouter(tags=["Health"])


@router.get("/")
@log_flow(layer="route")
async def root() -> dict:
    settings = get_settings()
    return {"name": settings.app_name, "version": "1.0.0", "docs": f"{settings.api_prefix}/docs"}


@router.get("/health")
@log_flow(layer="route")
async def health() -> dict:
    return {"status": "ok"}


@router.get("/health/ready")
@log_flow(layer="route")
async def readiness(session: AsyncSession = Depends(get_session)) -> dict:
    await session.execute(text("SELECT 1"))
    return {"status": "ready", "database": "ok"}
