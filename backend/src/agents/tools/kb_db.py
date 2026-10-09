"""Narrow write tool used by persist_cars: it can only ever insert or update rows in the cars table.

kb_agent no longer uses this module. It reads the vehicle catalog through src/agents/tools/catalog_tools.py, which
can only reach catalog_makes, catalog_models and catalog_variants.
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.schema import Car
from src.utils.log_flow import log_flow


@log_flow(layer="agent")
async def write_car(
    session: AsyncSession,
    *,
    created_by: str,
    brand_id: str,
    state_id: str,
    model: str,
    model_year: int,
    price: float,
    title: str | None = None,
    body_type: str | None = None,
    condition: str = "used",
    mileage: int = 0,
    fuel: str | None = None,
    transmission: str | None = None,
    status: str = "available",
) -> dict[str, Any]:
    """Write access, scoped ONLY to the `cars` table. Upserts by (brand_id, model, model_year) so a repeat
    web-search extraction for the same vehicle updates the existing row instead of duplicating it.
    The listing's owning dealer is recorded in `created_by`."""
    existing = (
        (
            await session.execute(
                select(Car).where(Car.brand_id == brand_id, Car.model == model, Car.model_year == model_year)
            )
        )
        .scalars()
        .first()
    )
    if existing:
        existing.price = price
        existing.mileage = mileage
        existing.body_type = body_type or existing.body_type
        existing.fuel = fuel or existing.fuel
        existing.transmission = transmission or existing.transmission
        existing.status = status
        existing.updated_by = created_by
        await session.flush()
        return {"id": existing.id, "model": existing.model, "model_year": existing.model_year, "upserted": "updated"}
    car = Car(
        created_by=created_by,
        brand_id=brand_id,
        state_id=state_id,
        title=title or f"{model_year} {model}",
        model=model,
        model_year=model_year,
        body_type=body_type,
        condition=condition,
        mileage=mileage,
        fuel=fuel,
        transmission=transmission,
        price=price,
        status=status,
        updated_by=created_by,
    )
    session.add(car)
    await session.flush()
    return {"id": car.id, "model": car.model, "model_year": car.model_year, "upserted": "created"}
