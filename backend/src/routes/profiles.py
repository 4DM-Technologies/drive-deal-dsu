from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.middleware.auth import get_current_profile, require_roles
from src.repositories.schema import BuyerPreference, Profile, User
from src.utils.exceptions import AppError, error_codes
from src.utils.serialization import model_dict

router = APIRouter(prefix="/profiles", tags=["Profiles"])


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str | None = None
    phone: str | None = None
    address: str | None = None
    state_id: str | None = None
    website: str | None = None
    branch_name: str | None = None


class PreferenceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    brand_id: str | None = None
    other_brand_ids: list[str] = Field(default_factory=list)
    model_preference: str | None = None
    body_type: str | None = None
    seater_count: int | None = None
    transmission: str | None = None
    drivetrain: str | None = None
    fuel_type: str | None = None
    condition: str | None = None
    exterior_color: str | None = None
    min_year: int | None = None
    max_mileage: int | None = None
    budget_min: int | None = None
    budget_max: int | None = None
    must_have_features: list[str] = Field(default_factory=list)
    never_want_features: list[str] = Field(default_factory=list)


@router.get("/me")
async def me(profile: Profile = Depends(get_current_profile)) -> dict:
    return model_dict(profile)


@router.patch("/me")
async def update_me(payload: ProfileUpdate, profile: Profile = Depends(get_current_profile), session: AsyncSession = Depends(get_session)) -> dict:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, field, value)
    profile.updated_by = profile.id
    await session.commit()
    await session.refresh(profile)
    return model_dict(profile)


@router.get("/me/preferences")
async def preferences(profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)) -> dict:
    row = await session.get(BuyerPreference, profile.id)
    return model_dict(row) if row else {"profile_id": profile.id}


@router.put("/me/preferences")
async def save_preferences(payload: PreferenceUpdate, profile: Profile = Depends(require_roles("buyer")), session: AsyncSession = Depends(get_session)) -> dict:
    row = await session.get(BuyerPreference, profile.id)
    values = payload.model_dump()
    if row is None:
        row = BuyerPreference(profile_id=profile.id, source="profile", created_by=profile.id, updated_by=profile.id, **values)
        session.add(row)
    else:
        for field, value in values.items():
            setattr(row, field, value)
        row.updated_by = profile.id
    await session.commit()
    await session.refresh(row)
    return model_dict(row)


@router.get("/{profile_id}")
async def profile_by_id(profile_id: str, _: Profile = Depends(require_roles("support", "admin")), session: AsyncSession = Depends(get_session)) -> dict:
    row = (await session.execute(select(Profile).join(User).where(Profile.id == profile_id))).scalar_one_or_none()
    if row is None:
        raise AppError(error_codes.RESOURCE_NOT_FOUND, "Profile not found.", 404)
    return model_dict(row)
