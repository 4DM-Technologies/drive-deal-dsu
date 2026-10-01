from decimal import Decimal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.middleware.auth import get_current_profile, require_roles
from src.repositories.marketplace_repository import MarketplaceRepository
from src.repositories.schema import Car, Profile
from src.utils.exceptions import AppError, error_codes
from src.utils.logger import logger
from src.utils.serialization import model_dict

router = APIRouter(prefix="/cars", tags=["Inventory"])


class CarCreate(BaseModel):
    brand_id: str
    state_id: str
    title: str
    model: str
    model_year: int = Field(ge=1990, le=2035)
    body_type: str | None = None
    seating_capacity: int | None = None
    condition: str = "new"
    mileage: int = Field(default=0, ge=0)
    fuel: str | None = None
    transmission: str | None = None
    price: Decimal = Field(gt=0)
    image_paths: list[str] = Field(default_factory=list)


class CarStatus(BaseModel):
    status: str = Field(pattern="^(available|reserved|sold|inactive)$")


@router.get("")
async def cars(profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    repository = MarketplaceRepository(session)
    rows = await (repository.cars_for_dealer(profile.id) if profile.role == "dealer" else repository.all_cars())
    return [model_dict(row) for row in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_car(payload: CarCreate, profile: Profile = Depends(require_roles("dealer")), session: AsyncSession = Depends(get_session)):
    row = Car(seller_id=profile.id, created_by=profile.id, updated_by=profile.id, **payload.model_dump())
    session.add(row)
    await session.commit()
    await session.refresh(row)
    logger.info("car_created", car_id=row.id, seller_id=profile.id)
    return model_dict(row)


@router.get("/{car_id}")
async def car(car_id: str, _: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)):
    row = await session.get(Car, car_id)
    if row is None:
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "Vehicle not found.", 404)
    return model_dict(row)


@router.patch("/{car_id}")
async def update_car(car_id: str, payload: CarCreate, profile: Profile = Depends(require_roles("dealer")), session: AsyncSession = Depends(get_session)):
    row = await session.get(Car, car_id)
    if row is None or row.seller_id != profile.id:
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "Vehicle not found.", 404)
    for field, value in payload.model_dump().items():
        setattr(row, field, value)
    row.updated_by = profile.id
    await session.commit()
    return model_dict(row)


@router.patch("/{car_id}/status")
async def car_status(car_id: str, payload: CarStatus, profile: Profile = Depends(require_roles("dealer")), session: AsyncSession = Depends(get_session)):
    row = await session.get(Car, car_id)
    if row is None or row.seller_id != profile.id:
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "Vehicle not found.", 404)
    row.status = payload.status
    row.updated_by = profile.id
    await session.commit()
    logger.info("car_status_changed", car_id=row.id, seller_id=profile.id, status=row.status)
    return model_dict(row)
