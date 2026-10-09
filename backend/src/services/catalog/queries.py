"""Read-only catalog lookups used by the guided question card.

Every query reads active rows only. Makes offered to buyers are limited to those linked to an active marketplace
brand, because a buyer request must reference `brands` (planning decision "Option A").
"""

from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.schema import Brand, CatalogMake, CatalogModel, CatalogVariant

BODY_STYLE_ORDER = ("SUV", "Sedan", "Truck", "Coupe", "Hatchback", "Convertible", "Wagon", "Minivan", "Van")


@dataclass
class MakeInfo:
    slug: str
    name: str
    brand_id: str | None
    brand_name: str | None

    @property
    def linked(self) -> bool:
        return self.brand_id is not None


@dataclass
class ModelInfo:
    make_slug: str
    slug: str
    name: str
    years: list[int] = field(default_factory=list)
    fuel_types: list[str] = field(default_factory=list)
    body_styles: list[str] = field(default_factory=list)


@dataclass
class VariantInfo:
    id: str
    model_year: int
    name: str
    trim_name: str | None
    body_style: str
    engine: str
    transmission: str
    drive_type: str
    fuel_type: str
    mpg_combined: int | None
    ev_range_miles: int | None

    @property
    def configuration(self) -> tuple[str, str, str, str, str]:
        """The parts of a variant that stay the same across model years."""
        return (self.name, self.engine, self.transmission, self.drive_type, self.fuel_type)

    def describe(self) -> str:
        parts = [self.engine if self.fuel_type != "Electric" else "Electric", self.transmission, self.drive_type]
        if self.fuel_type not in ("Gasoline", "Electric"):
            parts.append(self.fuel_type)
        if self.fuel_type == "Electric" and self.ev_range_miles:
            parts.append(f"{self.ev_range_miles} mi range")
        elif self.mpg_combined:
            parts.append(f"{self.mpg_combined} mpg combined")
        return " · ".join(parts)


def _body_sort_key(body_style: str) -> int:
    return BODY_STYLE_ORDER.index(body_style) if body_style in BODY_STYLE_ORDER else len(BODY_STYLE_ORDER)


class CatalogQueries:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def make(self, slug: str | None) -> MakeInfo | None:
        if not slug:
            return None
        row = (
            await self.session.execute(
                select(CatalogMake.slug, CatalogMake.name, CatalogMake.brand_id, Brand.name)
                .outerjoin(Brand, (Brand.id == CatalogMake.brand_id) & Brand.is_active.is_(True))
                .where(CatalogMake.slug == slug, CatalogMake.is_active.is_(True))
            )
        ).first()
        if row is None:
            return None
        brand_name = row[3]
        return MakeInfo(slug=row[0], name=row[1], brand_id=row[2] if brand_name else None, brand_name=brand_name)

    async def linked_makes(self, body_style: str | None = None) -> list[tuple[MakeInfo, int]]:
        """Makes buyers can request, with how many matching models each has."""
        statement = (
            select(CatalogMake.slug, CatalogMake.name, CatalogMake.brand_id, Brand.name, CatalogModel.slug)
            .join(Brand, (Brand.id == CatalogMake.brand_id) & Brand.is_active.is_(True))
            .join(CatalogModel, CatalogModel.make_id == CatalogMake.id)
            .join(CatalogVariant, CatalogVariant.model_id == CatalogModel.id)
            .where(
                CatalogMake.is_active.is_(True),
                CatalogModel.is_active.is_(True),
                CatalogVariant.is_active.is_(True),
            )
            .distinct()
        )
        if body_style:
            statement = statement.where(CatalogVariant.body_style == body_style)
        makes: dict[str, MakeInfo] = {}
        model_counts: dict[str, set[str]] = defaultdict(set)
        for slug, name, brand_id, brand_name, model_slug in (await self.session.execute(statement)).all():
            makes[slug] = MakeInfo(slug=slug, name=name, brand_id=brand_id, brand_name=brand_name)
            model_counts[slug].add(model_slug)
        return sorted(((make, len(model_counts[slug])) for slug, make in makes.items()), key=lambda item: item[0].name)

    async def models(self, make_slug: str, body_style: str | None = None) -> list[ModelInfo]:
        statement = (
            select(
                CatalogModel.slug,
                CatalogModel.name,
                CatalogVariant.model_year,
                CatalogVariant.fuel_type,
                CatalogVariant.body_style,
            )
            .join(CatalogMake, CatalogMake.id == CatalogModel.make_id)
            .join(CatalogVariant, CatalogVariant.model_id == CatalogModel.id)
            .where(
                CatalogMake.slug == make_slug,
                CatalogModel.is_active.is_(True),
                CatalogVariant.is_active.is_(True),
            )
        )
        if body_style:
            statement = statement.where(CatalogVariant.body_style == body_style)
        models: dict[str, ModelInfo] = {}
        for slug, name, year, fuel, body in (await self.session.execute(statement)).all():
            info = models.setdefault(slug, ModelInfo(make_slug=make_slug, slug=slug, name=name))
            if year not in info.years:
                info.years.append(year)
            if fuel not in info.fuel_types:
                info.fuel_types.append(fuel)
            if body not in info.body_styles:
                info.body_styles.append(body)
        for info in models.values():
            info.years.sort()
            info.body_styles.sort(key=_body_sort_key)
        return sorted(models.values(), key=lambda info: info.name.lower())

    async def model(self, make_slug: str | None, model_slug: str | None) -> ModelInfo | None:
        if not make_slug or not model_slug:
            return None
        return next((info for info in await self.models(make_slug) if info.slug == model_slug), None)

    async def body_styles(self, make_slug: str) -> list[tuple[str, list[str]]]:
        """Body styles a make offers, each with the model names that come in that style."""
        by_style: dict[str, set[str]] = defaultdict(set)
        for info in await self.models(make_slug):
            for body in info.body_styles:
                by_style[body].add(info.name)
        return [(body, sorted(by_style[body], key=str.lower)) for body in sorted(by_style, key=_body_sort_key)]

    async def _variant_rows(self, make_slug: str, model_slug: str) -> list[VariantInfo]:
        statement = (
            select(CatalogVariant)
            .join(CatalogModel, CatalogModel.id == CatalogVariant.model_id)
            .join(CatalogMake, CatalogMake.id == CatalogModel.make_id)
            .where(
                CatalogMake.slug == make_slug,
                CatalogModel.slug == model_slug,
                CatalogVariant.is_active.is_(True),
            )
        )
        return [
            VariantInfo(
                id=row.id,
                model_year=row.model_year,
                name=row.name,
                trim_name=row.trim_name,
                body_style=row.body_style,
                engine=row.engine,
                transmission=row.transmission,
                drive_type=row.drive_type,
                fuel_type=row.fuel_type,
                mpg_combined=row.mpg_combined,
                ev_range_miles=row.ev_range_miles,
            )
            for row in (await self.session.scalars(statement)).all()
        ]

    async def variants(
        self, make_slug: str, model_slug: str, year: int | None = None, filters: dict[str, str] | None = None
    ) -> list[VariantInfo]:
        """Variants of a model for one year: the given year, or the newest year the model is sold.

        Filters such as {"transmission": "Manual"} narrow the list, but are ignored when nothing would be left.
        """
        rows = await self._variant_rows(make_slug, model_slug)
        if not rows:
            return []
        target_year = year if year and any(row.model_year == year for row in rows) else max(r.model_year for r in rows)
        selected = [row for row in rows if row.model_year == target_year]
        for column, value in (filters or {}).items():
            if not value:
                continue
            narrowed = [row for row in selected if getattr(row, column) == value]
            if narrowed:
                selected = narrowed
        return sorted(selected, key=lambda row: (row.name.lower(), row.engine, row.transmission, row.drive_type))

    async def variant(
        self, variant_id: str | None, make_slug: str | None, model_slug: str | None
    ) -> VariantInfo | None:
        """A variant, only if it belongs to the given make and model."""
        if not variant_id or not make_slug or not model_slug:
            return None
        return next((row for row in await self._variant_rows(make_slug, model_slug) if row.id == variant_id), None)

    async def model_years(self, make_slug: str, model_slug: str, variant: VariantInfo | None = None) -> list[int]:
        """Years the model was sold, newest first. With a variant, only years that configuration exists."""
        rows = await self._variant_rows(make_slug, model_slug)
        if variant is not None:
            rows = [row for row in rows if row.configuration == variant.configuration] or rows
        return sorted({row.model_year for row in rows}, reverse=True)

    async def variant_for_year(self, variant: VariantInfo, make_slug: str, model_slug: str, year: int) -> VariantInfo:
        """The same configuration in another model year, falling back to the chosen variant."""
        rows = await self._variant_rows(make_slug, model_slug)
        return next(
            (row for row in rows if row.model_year == year and row.configuration == variant.configuration),
            variant,
        )
