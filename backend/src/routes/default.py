from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.settings import get_settings

router = APIRouter(tags=["Health"])


@router.get("/")
async def root() -> dict:
    settings = get_settings()
    return {"name": settings.app_name, "version": "1.0.0", "docs": f"{settings.api_prefix}/docs"}


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@router.get("/health/ready")
async def readiness(session: AsyncSession = Depends(get_session)) -> dict:
    await session.execute(text("SELECT 1"))
    return {"status": "ready", "database": "ok"}
