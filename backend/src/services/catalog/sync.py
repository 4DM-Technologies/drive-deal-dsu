"""Load the EPA bulk vehicle file into catalog_makes, catalog_models and catalog_variants.

The whole sync runs in the caller's session and transaction: validation runs before anything is written, and the
caller commits only when `sync_catalog` returns. A failure therefore leaves the catalog exactly as it was.
"""

import csv
import io
import tempfile
import zipfile
from collections import Counter, defaultdict
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.schema import Brand, CatalogMake, CatalogModel, CatalogVariant
from src.services.catalog.normalize import NormalizeReport, VariantRecord, build_variants

EPA_BULK_URL = "https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip"
SYNC_ACTOR = "catalog-sync"
VARIANT_FIELDS = (
    "trim_name",
    "body_style",
    "mpg_city",
    "mpg_highway",
    "mpg_combined",
    "ev_range_miles",
    "epa_vehicle_ids",
    "source_payload",
)
# Findings section 7. "Complete" years are every synced year except the newest, which EPA is still publishing.
MIN_MAKES_PER_COMPLETE_YEAR = 40
MIN_VARIANTS_PER_COMPLETE_YEAR = 900


class CatalogValidationError(RuntimeError):
    """Raised when normalized data fails a sanity check. Nothing has been written when this is raised."""


@dataclass
class SyncResult:
    years: list[int]
    source_rows: int
    excluded_rows: int
    unmapped_rows: int
    merged_groups: int
    variants: int
    makes_inserted: int = 0
    models_inserted: int = 0
    variants_inserted: int = 0
    variants_updated: int = 0
    variants_deactivated: int = 0
    brands_linked: int = 0
    per_year: dict[int, int] = field(default_factory=dict)

    @property
    def changed(self) -> bool:
        return any(
            (
                self.makes_inserted,
                self.models_inserted,
                self.variants_inserted,
                self.variants_updated,
                self.variants_deactivated,
                self.brands_linked,
            )
        )


def download_epa_bulk(destination: Path | None = None, *, timeout: float = 120) -> tuple[Path, str | None]:
    """Download vehicles.csv.zip. Returns the local path and the server's Last-Modified header."""
    directory = destination or Path(tempfile.mkdtemp(prefix="epa-catalog-"))
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / "vehicles.csv.zip"
    with httpx.stream("GET", EPA_BULK_URL, timeout=timeout, follow_redirects=True) as response:
        response.raise_for_status()
        with target.open("wb") as handle:
            for chunk in response.iter_bytes():
                handle.write(chunk)
        last_modified = response.headers.get("last-modified")
    return target, last_modified


def read_epa_rows(zip_path: Path) -> Iterator[dict[str, str]]:
    """Yield rows of the vehicles.csv file inside the EPA zip."""
    with zipfile.ZipFile(zip_path) as archive:
        csv_name = next(name for name in archive.namelist() if name.lower().endswith(".csv"))
        with archive.open(csv_name) as raw:
            yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8", errors="replace"))


def validate(report: NormalizeReport, years: list[int]) -> None:
    """Findings section 7. Runs on normalized records, before any write."""
    problems: list[str] = []
    if report.unmapped_rows:
        problems.append(f"{report.unmapped_rows} rows could not be mapped to allowed values")
    by_year: dict[int, list[VariantRecord]] = defaultdict(list)
    for record in report.variants:
        by_year[record.model_year].append(record)
    for year in sorted(years)[:-1]:
        records = by_year.get(year, [])
        makes = len({record.make_slug for record in records})
        if makes < MIN_MAKES_PER_COMPLETE_YEAR:
            problems.append(f"{year}: only {makes} makes (expected at least {MIN_MAKES_PER_COMPLETE_YEAR})")
        if len(records) < MIN_VARIANTS_PER_COMPLETE_YEAR:
            problems.append(
                f"{year}: only {len(records)} variants (expected at least {MIN_VARIANTS_PER_COMPLETE_YEAR})"
            )
    if 2025 in years:
        m3 = sorted(
            (record.name, record.transmission, record.drive_type)
            for record in by_year[2025]
            if (record.make_slug, record.model_slug) == ("bmw", "m3")
        )
        expected_m3 = [
            ("M3 Competition M xDrive Sedan", "Automatic", "AWD"),
            ("M3 Competition Sedan", "Automatic", "RWD"),
            ("M3 Sedan", "Manual", "RWD"),
        ]
        if m3 != expected_m3:
            problems.append(f"2025 BMW M3 variants are {m3}, expected {expected_m3}")
        rav4_fuels = {
            record.fuel_type for record in by_year[2025] if (record.make_slug, record.model_slug) == ("toyota", "rav4")
        }
        if not {"Gasoline", "Hybrid", "Plug-in hybrid"} <= rav4_fuels:
            problems.append(f"2025 Toyota RAV4 fuel types are {sorted(rav4_fuels)}")
    if problems:
        raise CatalogValidationError("; ".join(problems))


async def _upsert_makes(session: AsyncSession, records: list[VariantRecord], result: SyncResult) -> dict[str, str]:
    names = {record.make_slug: record.make for record in records}
    existing = {make.slug: make for make in (await session.scalars(select(CatalogMake))).all()}
    for slug, name in names.items():
        if slug in existing:
            make = existing[slug]
            if make.name != name:
                make.name, make.updated_by = name, SYNC_ACTOR
        else:
            make = CatalogMake(name=name, slug=slug, is_active=True, created_by=SYNC_ACTOR, updated_by=SYNC_ACTOR)
            session.add(make)
            existing[slug] = make
            result.makes_inserted += 1
    await session.flush()
    return {slug: make.id for slug, make in existing.items()}


async def _upsert_models(
    session: AsyncSession, records: list[VariantRecord], make_ids: dict[str, str], result: SyncResult
) -> dict[tuple[str, str], str]:
    # The newest model year decides the display name when EPA spelling changes between years.
    names: dict[tuple[str, str], tuple[int, str]] = {}
    for record in records:
        key = (record.make_slug, record.model_slug)
        if key not in names or record.model_year >= names[key][0]:
            names[key] = (record.model_year, record.family)
    slug_by_make_id = {make_id: slug for slug, make_id in make_ids.items()}
    existing = {
        (slug_by_make_id.get(model.make_id), model.slug): model
        for model in (await session.scalars(select(CatalogModel))).all()
    }
    for (make_slug, model_slug), (_, name) in names.items():
        model = existing.get((make_slug, model_slug))
        if model is None:
            model = CatalogModel(
                make_id=make_ids[make_slug],
                name=name,
                slug=model_slug,
                is_active=True,
                created_by=SYNC_ACTOR,
                updated_by=SYNC_ACTOR,
            )
            session.add(model)
            existing[(make_slug, model_slug)] = model
            result.models_inserted += 1
        elif model.name != name:
            model.name, model.updated_by = name, SYNC_ACTOR
    await session.flush()
    return {key: model.id for key, model in existing.items()}


async def _upsert_variants(
    session: AsyncSession,
    records: list[VariantRecord],
    model_ids: dict[tuple[str, str], str],
    years: list[int],
    result: SyncResult,
) -> None:
    existing: dict[tuple, CatalogVariant] = {}
    for variant in (await session.scalars(select(CatalogVariant).where(CatalogVariant.model_year.in_(years)))).all():
        existing[
            (
                variant.model_id,
                variant.model_year,
                variant.name,
                variant.engine,
                variant.transmission,
                variant.drive_type,
                variant.fuel_type,
            )
        ] = variant
    seen: set[tuple] = set()
    for record in records:
        model_id = model_ids[(record.make_slug, record.model_slug)]
        key = (model_id, *record.configuration)
        seen.add(key)
        variant = existing.get(key)
        if variant is None:
            session.add(
                CatalogVariant(
                    model_id=model_id,
                    model_year=record.model_year,
                    name=record.name,
                    engine=record.engine,
                    transmission=record.transmission,
                    drive_type=record.drive_type,
                    fuel_type=record.fuel_type,
                    is_active=True,
                    created_by=SYNC_ACTOR,
                    updated_by=SYNC_ACTOR,
                    **{name: getattr(record, name) for name in VARIANT_FIELDS},
                )
            )
            result.variants_inserted += 1
            continue
        changes = {
            name: getattr(record, name) for name in VARIANT_FIELDS if getattr(variant, name) != getattr(record, name)
        }
        if not variant.is_active:
            changes["is_active"] = True
        if changes:
            for name, value in changes.items():
                setattr(variant, name, value)
            variant.updated_by = SYNC_ACTOR
            result.variants_updated += 1
    for key, variant in existing.items():
        if key not in seen and variant.is_active:
            variant.is_active, variant.updated_by = False, SYNC_ACTOR
            result.variants_deactivated += 1
    await session.flush()


async def _refresh_active_flags(session: AsyncSession) -> None:
    """A model is active when it has an active variant in any year, and a make when it has an active model."""
    active_models = select(CatalogVariant.model_id).where(CatalogVariant.is_active.is_(True)).distinct()
    for flag, condition in ((True, CatalogModel.id.in_(active_models)), (False, CatalogModel.id.not_in(active_models))):
        await session.execute(
            update(CatalogModel)
            .where(condition, CatalogModel.is_active.is_not(flag))
            .values(is_active=flag, updated_by=SYNC_ACTOR)
        )
    active_makes = select(CatalogModel.make_id).where(CatalogModel.is_active.is_(True)).distinct()
    for flag, condition in ((True, CatalogMake.id.in_(active_makes)), (False, CatalogMake.id.not_in(active_makes))):
        await session.execute(
            update(CatalogMake)
            .where(condition, CatalogMake.is_active.is_not(flag))
            .values(is_active=flag, updated_by=SYNC_ACTOR)
        )


async def _link_brands(session: AsyncSession, result: SyncResult) -> None:
    """Findings 6.9: point makes at the marketplace brand with the same name. Never writes to `brands`."""
    brands = {brand.name.lower(): brand.id for brand in (await session.scalars(select(Brand))).all()}
    for make in (await session.scalars(select(CatalogMake).where(CatalogMake.brand_id.is_(None)))).all():
        brand_id = brands.get(make.name.lower())
        if brand_id:
            make.brand_id, make.updated_by = brand_id, SYNC_ACTOR
            result.brands_linked += 1
    await session.flush()


async def sync_catalog(
    session: AsyncSession, rows: Iterator[dict[str, str]], years: list[int], *, run_validation: bool = True
) -> SyncResult:
    """Normalize `rows` for `years` and upsert them. The caller owns the transaction and must commit."""
    report = build_variants(rows, set(years))
    if run_validation:
        validate(report, years)
    result = SyncResult(
        years=sorted(years),
        source_rows=report.source_rows,
        excluded_rows=report.excluded_rows,
        unmapped_rows=report.unmapped_rows,
        merged_groups=report.merged_groups,
        variants=len(report.variants),
        per_year=dict(sorted(Counter(record.model_year for record in report.variants).items())),
    )
    make_ids = await _upsert_makes(session, report.variants, result)
    model_ids = await _upsert_models(session, report.variants, make_ids, result)
    await _upsert_variants(session, report.variants, model_ids, result.years, result)
    await _refresh_active_flags(session)
    await _link_brands(session, result)
    return result


async def catalog_counts(session: AsyncSession) -> dict[str, int]:
    """Active row counts, for the post-sync summary."""
    counts = {}
    for label, table in (("makes", CatalogMake), ("models", CatalogModel), ("variants", CatalogVariant)):
        counts[label] = await session.scalar(select(func.count()).select_from(table).where(table.is_active.is_(True)))
    return counts
