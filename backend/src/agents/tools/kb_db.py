"""kb_agent's four tools. Each is scoped to exactly one job (least privilege, by design):

- describe_schema / query_data: read-only, derived from Base.metadata, never issue a write.
- update_preferences: write access, but only ever to buyer_preference.must_have_features for one profile_id.
- write_car: write access, but only ever to the cars table.
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import Base
from src.repositories.schema import BuyerPreference, Car
from src.utils.log_flow import log_flow


@log_flow(layer="agent")
def describe_schema() -> dict[str, list[str]]:
    """Read-only. Introspects Base.metadata so there is no hardcoded table list to maintain."""
    return {name: [column.name for column in table.columns] for name, table in Base.metadata.tables.items()}


@log_flow(layer="agent")
async def query_data(
    session: AsyncSession, table: str, filters: dict[str, Any] | None = None, limit: int = 20
) -> list[dict[str, Any]]:
    """Read-only, parameterized SELECT against any mapped table. Never writes: the only statement it can ever
    build is a `select()`. Column names in `filters` are validated against the table's real columns before use,
    and values are always bound parameters via SQLAlchemy Core - never string-interpolated SQL."""
    tables = Base.metadata.tables
    if table not in tables:
        raise ValueError(f"Unknown table: {table}")
    core_table = tables[table]
    statement = select(core_table)
    for column, value in (filters or {}).items():
        if column not in core_table.columns:
            raise ValueError(f"Unknown column '{column}' on table '{table}'")
        statement = statement.where(core_table.c[column] == value)
    statement = statement.limit(max(1, min(limit, 100)))
    rows = (await session.execute(statement)).mappings().all()
    return [dict(row) for row in rows]


@log_flow(layer="agent")
async def update_preferences(session: AsyncSession, profile_id: str, features: list[str]) -> dict[str, Any]:
    """Write access, but intentionally narrower than PUT /profiles/me/preferences: this tool can only ever set
    must_have_features for the given profile_id. It never reads or writes budget_min, brand_id, or any other
    column on that row, and never touches any other table."""
    row = await session.get(BuyerPreference, profile_id)
    if row is None:
        row = BuyerPreference(
            profile_id=profile_id,
            must_have_features=list(features),
            source="advisor",
            created_by=profile_id,
            updated_by=profile_id,
        )
        session.add(row)
    else:
        row.must_have_features = list(features)
        row.updated_by = profile_id
    await session.flush()
    return {"profile_id": profile_id, "must_have_features": list(row.must_have_features)}


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
