"""The brands a dealership sells: catalog brands by id, plus names typed under "Other" for brands not in the catalog.

Typed names are kept on the profile rather than added to the brands table, because that table is also the brand list
buyers pick from. A typed name that matches a catalog brand is stored as that brand instead.
"""

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.auth import clean_other_brands
from src.repositories.schema import Brand
from src.utils.exceptions import AppError, error_codes


async def resolve_dealer_brands(
    session: AsyncSession, brand_ids: Iterable[str], other_brands: Iterable[str]
) -> tuple[list[str], list[str]]:
    """Checks the catalog ids and folds typed names that match a catalog brand into ids.

    Returns ``(brand_ids, other_brands)``; at least one of them is non-empty.
    """
    catalog = list((await session.execute(select(Brand).where(Brand.is_active.is_(True)))).scalars())
    active_ids = {brand.id for brand in catalog}
    by_name = {brand.name.casefold(): brand.id for brand in catalog}

    ids: list[str] = []
    for brand_id in brand_ids:
        if brand_id not in active_ids:
            raise AppError(error_codes.VALIDATION_ERROR, "One of the selected brands is not available.", 422)
        if brand_id not in ids:
            ids.append(brand_id)
    others: list[str] = []
    for name in clean_other_brands(other_brands):
        matched = by_name.get(name.casefold())
        if matched is None:
            others.append(name)
        elif matched not in ids:
            ids.append(matched)
    if not ids and not others:
        raise AppError(error_codes.VALIDATION_ERROR, "Choose at least one brand your dealership sells.", 422)
    return ids, others


async def brand_names(session: AsyncSession, brand_ids: Iterable[str]) -> dict[str, str]:
    """Catalog names by id, for showing a dealer's brands to people instead of ids."""
    ids = set(brand_ids)
    if not ids:
        return {}
    rows = await session.execute(select(Brand.id, Brand.name).where(Brand.id.in_(ids)))
    return dict(rows.all())
