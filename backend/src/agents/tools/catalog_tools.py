"""kb_agent's catalog tools: read-only access to catalog_makes, catalog_models and catalog_variants only.

The LLM never writes SQL. It returns a JSON plan naming up to three of the four tools below with arguments; every
argument is validated against fixed allowed values and every make/model name is resolved against the catalog before
a fixed, parameterized query runs. This module deliberately imports no other table.
"""

import json
import re
from dataclasses import dataclass, field
from difflib import get_close_matches
from time import perf_counter
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.schema import CatalogMake, CatalogModel, CatalogVariant
from src.services.catalog.matcher import NICKNAMES, CatalogIndex, MatchResult, load_catalog_index
from src.utils.logger import logger

BodyStyle = Literal["SUV", "Sedan", "Coupe", "Convertible", "Hatchback", "Wagon", "Truck", "Minivan", "Van"]
FuelType = Literal["Gasoline", "Mild hybrid", "Hybrid", "Plug-in hybrid", "Electric", "Diesel", "Flex fuel", "Hydrogen"]
DriveType = Literal["AWD", "4WD", "FWD", "RWD"]
Transmission = Literal["Automatic", "Manual"]
ToolName = Literal["list_makes", "list_models", "get_model_details", "find_vehicles"]

MAX_CALLS = 3
MAX_ROWS = 25
BODY_WORDS = (
    ("SUV", re.compile(r"\b(suvs?|crossovers?)\b", re.I)),
    ("Truck", re.compile(r"\b(trucks?|pickups?)\b", re.I)),
    ("Sedan", re.compile(r"\bsedans?\b", re.I)),
    ("Coupe", re.compile(r"\bcoupes?\b", re.I)),
    ("Convertible", re.compile(r"\b(convertibles?|cabriolets?|roadsters?)\b", re.I)),
    ("Hatchback", re.compile(r"\bhatch(back)?s?\b", re.I)),
    ("Wagon", re.compile(r"\bwagons?\b", re.I)),
    ("Minivan", re.compile(r"\bminivans?\b", re.I)),
)
# Words that turn "tell me about the RAV4" into a broader search ("cars like the RAV4"), which needs the LLM plan.
BROADER_RE = re.compile(
    r"\b(similar|alternatives?|like the|rivals?|competitors?|other|others|instead|best|cheapest|top|"
    r"most|least|which (?:cars|suvs|trucks|models)|options)\b",
    re.I,
)


class _Args(BaseModel):
    model_config = ConfigDict(extra="ignore")


class ListMakesArgs(_Args):
    body_style: BodyStyle | None = None
    fuel_type: FuelType | None = None


class ListModelsArgs(_Args):
    make: str = Field(min_length=1, max_length=80)
    body_style: BodyStyle | None = None
    fuel_type: FuelType | None = None
    year: int | None = Field(default=None, ge=1984, le=2100)


class ModelDetailsArgs(_Args):
    make: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=120)
    year: int | None = Field(default=None, ge=1984, le=2100)


class FindVehiclesArgs(_Args):
    make: str | None = Field(default=None, max_length=80)
    model: str | None = Field(default=None, max_length=120)
    body_style: BodyStyle | None = None
    fuel_type: FuelType | None = None
    drive_type: DriveType | None = None
    transmission: Transmission | None = None
    year_min: int | None = Field(default=None, ge=1984, le=2100)
    year_max: int | None = Field(default=None, ge=1984, le=2100)
    min_mpg: int | None = Field(default=None, ge=0, le=500)
    min_ev_range: int | None = Field(default=None, ge=0, le=1000)
    sort_by: Literal["mpg", "ev_range", "year"] | None = None
    limit: int = Field(default=10, ge=1, le=MAX_ROWS)


ARGS_BY_TOOL: dict[str, type[_Args]] = {
    "list_makes": ListMakesArgs,
    "list_models": ListModelsArgs,
    "get_model_details": ModelDetailsArgs,
    "find_vehicles": FindVehiclesArgs,
}


class ToolCall(BaseModel):
    model_config = ConfigDict(extra="ignore")
    # A plain string, so one unknown tool name is rejected on its own by the executor instead of voiding the plan.
    tool: str = Field(max_length=60)
    args: dict[str, Any] = Field(default_factory=dict)


class ToolPlan(BaseModel):
    model_config = ConfigDict(extra="ignore")
    calls: list[ToolCall] = Field(default_factory=list)


@dataclass
class ToolResult:
    tool: str
    args: dict[str, Any]
    rows: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    duration_ms: int = 0

    def as_evidence(self) -> dict[str, Any]:
        evidence: dict[str, Any] = {"tool": self.tool, "args": self.args}
        if self.error:
            evidence["error"] = self.error
        else:
            evidence["rows"] = self.rows
        return evidence


def parse_plan(text: str) -> ToolPlan:
    """Parse the LLM's JSON plan. Raises ValueError when there is no usable JSON object."""
    match = re.search(r"\{.*\}", text or "", re.DOTALL)
    if not match:
        raise ValueError("no JSON object in tool plan")
    try:
        plan = ToolPlan.model_validate(json.loads(match.group(0)))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise ValueError(f"invalid tool plan: {exc}") from exc
    plan.calls = plan.calls[:MAX_CALLS]
    return plan


def body_style_hint(message: str) -> str | None:
    return next((label for label, pattern in BODY_WORDS if pattern.search(message)), None)


def shortcut_plan(message: str, hints: MatchResult) -> ToolPlan | None:
    """A plan built in code when the buyer names specific models and asks nothing broader. Saves the LLM call."""
    if BROADER_RE.search(message):
        return None
    pairs = [(make, model) for make, model in hints.candidates if model] if hints.candidates else []
    if hints.make and hints.model:
        pairs = [(hints.make, hints.model)]
    if not pairs:
        return None
    return ToolPlan(
        calls=[
            ToolCall(
                tool="get_model_details",
                args={
                    "make": make.name,
                    "model": model.name,
                    **({"year": hints.model_year} if hints.model_year else {}),
                },
            )
            for make, model in pairs[:MAX_CALLS]
        ]
    )


def fallback_plan(message: str, hints: MatchResult) -> ToolPlan:
    """Used when the LLM plan cannot be parsed: a reasonable lookup from the matcher's hints, or nothing."""
    if (plan := shortcut_plan("", hints)) is not None:
        return plan
    body = body_style_hint(message)
    if hints.make:
        args = {"make": hints.make.name, **({"body_style": body} if body else {})}
        if hints.filters.get("fuel_type"):
            args["fuel_type"] = hints.filters["fuel_type"]
        return ToolPlan(calls=[ToolCall(tool="list_models", args=args)])
    filters = {key: value for key, value in hints.filters.items() if key in ("fuel_type", "drive_type", "transmission")}
    if body or filters:
        return ToolPlan(
            calls=[ToolCall(tool="find_vehicles", args={**filters, **({"body_style": body} if body else {})})]
        )
    return ToolPlan()


# ------------------------------------------------------------------------------------------------- name resolution


def _key(text: str) -> str:
    return "".join(re.findall(r"[a-z0-9]+", text.lower()))


def resolve_make(index: CatalogIndex, name: str | None) -> str | None:
    if not name:
        return None
    key = _key(name)
    slug = index.make_keys.get(key) or NICKNAMES.get(key)
    if slug in index.makes:
        return slug
    close = get_close_matches(key, list(index.make_keys), n=1, cutoff=0.8)
    return index.make_keys[close[0]] if close else None


def resolve_model(index: CatalogIndex, make_slug: str | None, name: str | None) -> str | None:
    if not name or not make_slug:
        return None
    candidates = {model.key: model.slug for model in index.models if model.make_slug == make_slug}
    key = _key(name)
    make_key = _key(index.makes[make_slug].name) if make_slug in index.makes else ""
    if make_key and key.startswith(make_key) and key != make_key:
        key = key[len(make_key) :]  # "BMW M3" given as the model name
    if key in candidates:
        return candidates[key]
    variant_model = index.variant_words.get(make_slug, {}).get(key)
    if variant_model:
        return variant_model.slug
    close = get_close_matches(key, list(candidates), n=1, cutoff=0.8)
    return candidates[close[0]] if close else None


# ------------------------------------------------------------------------------------------------------- queries


def _variant_row(make: str, model: str, variant: CatalogVariant, *, with_names: bool = True) -> dict[str, Any]:
    row: dict[str, Any] = {"make": make, "model": model} if with_names else {}
    row.update(
        {
            "year": variant.model_year,
            "version": variant.name,
            "trim": variant.trim_name,
            "body_style": variant.body_style,
            "engine": variant.engine,
            "transmission": variant.transmission,
            "drive": variant.drive_type,
            "fuel": variant.fuel_type,
            "mpg_city": variant.mpg_city,
            "mpg_highway": variant.mpg_highway,
            "mpg_combined": variant.mpg_combined,
            "ev_range_miles": variant.ev_range_miles,
        }
    )
    return {key: value for key, value in row.items() if value is not None}


def _variant_query():
    return (
        select(CatalogMake.name, CatalogModel.name, CatalogVariant)
        .join(CatalogModel, CatalogModel.make_id == CatalogMake.id)
        .join(CatalogVariant, CatalogVariant.model_id == CatalogModel.id)
        .where(CatalogMake.is_active.is_(True), CatalogModel.is_active.is_(True), CatalogVariant.is_active.is_(True))
    )


async def list_makes(session: AsyncSession, args: ListMakesArgs, index: CatalogIndex) -> list[dict[str, Any]]:
    statement = (
        select(CatalogMake.name, CatalogMake.slug, CatalogMake.brand_id, CatalogModel.slug)
        .join(CatalogModel, CatalogModel.make_id == CatalogMake.id)
        .join(CatalogVariant, CatalogVariant.model_id == CatalogModel.id)
        .where(CatalogMake.is_active.is_(True), CatalogModel.is_active.is_(True), CatalogVariant.is_active.is_(True))
        .distinct()
    )
    if args.body_style:
        statement = statement.where(CatalogVariant.body_style == args.body_style)
    if args.fuel_type:
        statement = statement.where(CatalogVariant.fuel_type == args.fuel_type)
    makes: dict[str, dict[str, Any]] = {}
    for name, slug, brand_id, model_slug in (await session.execute(statement)).all():
        entry = makes.setdefault(slug, {"make": name, "models": set(), "in_dealer_network": brand_id is not None})
        entry["models"].add(model_slug)
    rows = [{**entry, "models": len(entry["models"])} for entry in makes.values()]
    return sorted(rows, key=lambda row: (not row["in_dealer_network"], row["make"]))[:60]


async def list_models(session: AsyncSession, args: ListModelsArgs, index: CatalogIndex) -> list[dict[str, Any]]:
    make_slug = resolve_make(index, args.make)
    if make_slug is None:
        raise LookupError(f"unknown make {args.make!r}")
    statement = _variant_query().where(CatalogMake.slug == make_slug)
    if args.body_style:
        statement = statement.where(CatalogVariant.body_style == args.body_style)
    if args.fuel_type:
        statement = statement.where(CatalogVariant.fuel_type == args.fuel_type)
    if args.year:
        statement = statement.where(CatalogVariant.model_year == args.year)
    models: dict[str, dict[str, Any]] = {}
    for make_name, model_name, variant in (await session.execute(statement)).all():
        entry = models.setdefault(
            model_name,
            {
                "make": make_name,
                "model": model_name,
                "years": set(),
                "fuel_types": set(),
                "body_styles": set(),
                "versions": 0,
            },
        )
        entry["years"].add(variant.model_year)
        entry["fuel_types"].add(variant.fuel_type)
        entry["body_styles"].add(variant.body_style)
        entry["versions"] += 1
    rows = [
        {
            **entry,
            "years": sorted(entry["years"]),
            "fuel_types": sorted(entry["fuel_types"]),
            "body_styles": sorted(entry["body_styles"]),
        }
        for entry in models.values()
    ]
    return sorted(rows, key=lambda row: row["model"].lower())[:60]


async def get_model_details(session: AsyncSession, args: ModelDetailsArgs, index: CatalogIndex) -> list[dict[str, Any]]:
    make_slug = resolve_make(index, args.make)
    model_slug = resolve_model(index, make_slug, args.model)
    if make_slug is None or model_slug is None:
        raise LookupError(f"unknown vehicle {args.make!r} {args.model!r}")
    rows = (
        await session.execute(_variant_query().where(CatalogMake.slug == make_slug, CatalogModel.slug == model_slug))
    ).all()
    if not rows:
        return []
    years = sorted({variant.model_year for _, _, variant in rows})
    year = args.year if args.year in years else years[-1]
    make_name, model_name = rows[0][0], rows[0][1]
    versions = [
        _variant_row(make_name, model_name, variant, with_names=False)
        for _, _, variant in rows
        if variant.model_year == year
    ]
    versions.sort(key=lambda row: (row["version"], row.get("engine", "")))
    return [
        {
            "make": make_name,
            "model": model_name,
            "years_available": years,
            "year_shown": year,
            "versions": versions[:MAX_ROWS],
        }
    ]


async def find_vehicles(session: AsyncSession, args: FindVehiclesArgs, index: CatalogIndex) -> list[dict[str, Any]]:
    statement = _variant_query()
    if args.make:
        make_slug = resolve_make(index, args.make)
        if make_slug is None:
            raise LookupError(f"unknown make {args.make!r}")
        statement = statement.where(CatalogMake.slug == make_slug)
        if args.model:
            model_slug = resolve_model(index, make_slug, args.model)
            if model_slug is None:
                raise LookupError(f"unknown model {args.model!r}")
            statement = statement.where(CatalogModel.slug == model_slug)
    for column, value in (
        (CatalogVariant.body_style, args.body_style),
        (CatalogVariant.fuel_type, args.fuel_type),
        (CatalogVariant.drive_type, args.drive_type),
        (CatalogVariant.transmission, args.transmission),
    ):
        if value:
            statement = statement.where(column == value)
    if args.year_min:
        statement = statement.where(CatalogVariant.model_year >= args.year_min)
    if args.year_max:
        statement = statement.where(CatalogVariant.model_year <= args.year_max)
    if args.min_mpg:
        statement = statement.where(CatalogVariant.mpg_combined >= args.min_mpg)
    if args.min_ev_range:
        statement = statement.where(CatalogVariant.ev_range_miles >= args.min_ev_range)
    year_filtered = bool(args.year_min or args.year_max)
    collected: dict[tuple, tuple[str, str, CatalogVariant]] = {}
    for make_name, model_name, variant in (await session.execute(statement.limit(5000))).all():
        # Without a year filter, keep only the newest year of each configuration so results are not repeated.
        config = (
            make_name,
            model_name,
            variant.name,
            variant.engine,
            variant.transmission,
            variant.drive_type,
            variant.fuel_type,
        )
        key = (*config, variant.model_year) if year_filtered else config
        current = collected.get(key)
        if current is None or variant.model_year > current[2].model_year:
            collected[key] = (make_name, model_name, variant)
    rows = [_variant_row(make_name, model_name, variant) for make_name, model_name, variant in collected.values()]
    sort_key = {"mpg": "mpg_combined", "ev_range": "ev_range_miles", "year": "year"}.get(args.sort_by or "")
    if sort_key:
        rows.sort(key=lambda row: row.get(sort_key) or 0, reverse=True)
    else:
        rows.sort(key=lambda row: (row["make"], row["model"], -row["year"], row["version"]))
    return rows[: args.limit]


TOOLS = {
    "list_makes": list_makes,
    "list_models": list_models,
    "get_model_details": get_model_details,
    "find_vehicles": find_vehicles,
}


async def run_catalog_tools(session: AsyncSession, plan: ToolPlan) -> list[ToolResult]:
    """Validate and run each planned call. A bad call is reported in its result and never raises."""
    if not plan.calls:
        return []
    index = await load_catalog_index(session)
    results: list[ToolResult] = []
    for call in plan.calls[:MAX_CALLS]:
        started = perf_counter()
        result = ToolResult(tool=call.tool, args=call.args)
        if call.tool not in TOOLS:
            result.error = f"unknown tool {call.tool!r}"
            logger.warning("catalog_tool_rejected", tool=call.tool)
            results.append(result)
            continue
        try:
            args = ARGS_BY_TOOL[call.tool].model_validate(call.args)
            result.args = args.model_dump(exclude_none=True)
            result.rows = await TOOLS[call.tool](session, args, index)
        except ValidationError as exc:
            result.error = "invalid arguments: " + "; ".join(
                f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}" for error in exc.errors()[:3]
            )
        except LookupError as exc:
            result.error = str(exc)
        result.duration_ms = int((perf_counter() - started) * 1000)
        logger.info(
            "catalog_tool_call",
            tool=call.tool,
            args=result.args,
            rows=len(result.rows),
            error=result.error,
            ms=result.duration_ms,
        )
        results.append(result)
    return results
