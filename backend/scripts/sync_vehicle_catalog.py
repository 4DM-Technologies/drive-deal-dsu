"""Sync the vehicle catalog tables from the EPA bulk file (fueleconomy.gov vehicles.csv.zip).

Downloads the file (or reads a local copy), normalizes it with the rules in
testing/vehicle-catalog-poc/CATALOG_DATA_FINDINGS.md, validates it, and upserts catalog_makes, catalog_models and
catalog_variants in one transaction. Safe to re-run: a second run with the same file changes nothing.

Usage (run from the backend/ directory so the src package resolves):
    python scripts/sync_vehicle_catalog.py                     # last 3 model years, this year and next year
    python scripts/sync_vehicle_catalog.py --years 2024-2026
    python scripts/sync_vehicle_catalog.py --file ./vehicles.csv.zip
    python scripts/sync_vehicle_catalog.py --dry-run           # normalize and validate only, no database access
"""

import argparse
import asyncio
import json
import sys
import time
from dataclasses import asdict
from datetime import date
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.services.catalog.normalize import build_variants  # noqa: E402
from src.services.catalog.sync import (  # noqa: E402
    CatalogValidationError,
    catalog_counts,
    download_epa_bulk,
    read_epa_rows,
    sync_catalog,
    validate,
)


def parse_years(value: str) -> list[int]:
    if "-" in value:
        start, end = (int(part) for part in value.split("-", 1))
        if end < start:
            raise argparse.ArgumentTypeError("year range must be ascending, for example 2023-2027")
        return list(range(start, end + 1))
    return [int(part) for part in value.split(",")]


def default_years() -> list[int]:
    this_year = date.today().year
    return list(range(this_year - 3, this_year + 2))


async def run_sync(zip_path: Path, years: list[int]) -> dict:
    # Imported here so --dry-run never creates a database engine.
    from src.database import SessionFactory, dispose_engine

    try:
        async with SessionFactory() as session:
            try:
                result = await sync_catalog(session, read_epa_rows(zip_path), years)
                await session.commit()
            except BaseException:
                await session.rollback()
                raise
            counts = await catalog_counts(session)
    finally:
        await dispose_engine()
    return {**asdict(result), "active_counts": counts}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--years", type=parse_years, default=default_years(), help="2023-2027 or 2024,2025")
    parser.add_argument("--file", type=Path, help="use a local vehicles.csv.zip instead of downloading")
    parser.add_argument("--dry-run", action="store_true", help="normalize and validate only; do not touch the database")
    args = parser.parse_args()

    started = time.perf_counter()
    if args.file:
        zip_path, last_modified = args.file, None
    else:
        print("Downloading EPA bulk file ...")
        zip_path, last_modified = download_epa_bulk()
    print(f"Source: {zip_path} (Last-Modified: {last_modified or 'n/a'}) | years: {args.years}")

    try:
        if args.dry_run:
            report = build_variants(read_epa_rows(zip_path), set(args.years))
            validate(report, args.years)
            summary = {
                "dry_run": True,
                "source_rows": report.source_rows,
                "excluded_rows": report.excluded_rows,
                "unmapped_rows": report.unmapped_rows,
                "merged_groups": report.merged_groups,
                "variants": len(report.variants),
                "makes": len({record.make_slug for record in report.variants}),
                "models": len({(record.make_slug, record.model_slug) for record in report.variants}),
            }
        else:
            summary = asyncio.run(run_sync(zip_path, args.years))
    except CatalogValidationError as error:
        print(f"Validation failed, nothing was written: {error}", file=sys.stderr)
        return 1

    summary["seconds"] = round(time.perf_counter() - started, 1)
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
