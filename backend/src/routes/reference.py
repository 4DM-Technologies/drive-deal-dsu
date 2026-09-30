from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.repositories.schema import Brand, State
from src.utils.exceptions import AppError, error_codes
from src.utils.serialization import model_dict

router = APIRouter(prefix="/reference", tags=["Reference"])


@router.get("/states")
async def list_states(session: AsyncSession = Depends(get_session)) -> list[dict]:
    rows = (await session.execute(select(State).where(State.is_active.is_(True)).order_by(State.name))).scalars()
    return [model_dict(row) for row in rows]


@router.get("/states/{code}/tax-rate")
async def tax_rate(code: str, session: AsyncSession = Depends(get_session)) -> dict:
    row = (await session.execute(select(State).where(State.code == code.upper()))).scalar_one_or_none()
    if row is None:
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "State not found.", 404)
    return {"state_code": row.code, "rate": f"{row.sales_tax_rate:.5f}", "scope": "state_only"}


@router.get("/brands")
async def list_brands(session: AsyncSession = Depends(get_session)) -> list[dict]:
    rows = (await session.execute(select(Brand).where(Brand.is_active.is_(True)).order_by(Brand.name))).scalars()
    return [model_dict(row) for row in rows]
