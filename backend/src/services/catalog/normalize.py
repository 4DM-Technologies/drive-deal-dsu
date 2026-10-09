"""Pure functions that turn EPA `vehicles.csv` rows into catalog variant records.

No I/O and no database access, so every rule can be unit-tested with plain dictionaries. Section numbers refer to
testing/vehicle-catalog-poc/CATALOG_DATA_FINDINGS.md.
"""

import re
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

# 6.1 Rows that are not retail vehicles.
EXCLUDE_RE = re.compile(r"\b(cab chassis|robo ?taxi|police|ppv)\b", re.IGNORECASE)
# 6.2 Wheel/tire text in brackets, and drive words that duplicate the drive_type column.
WHEELS_RE = re.compile(r"\s*\((?:[^)]*\b(?:inch|in\.|wheels?|tires?)\b[^)]*)\)", re.IGNORECASE)
DRIVE_WORDS_RE = re.compile(r"\b(2WD|4WD|AWD|FWD|RWD|4x4|4x2)\b", re.IGNORECASE)
# 6.3 Body words removed when deriving trim_name, because body style has its own column.
TRIM_BODY_WORDS_RE = re.compile(
    r"\b(gran coupe|sedan|coupe|convertible|cabriolet|roadster|wagon|hatchback|5-door|5dr|4dr|pickup)\b",
    re.IGNORECASE,
)
# 6.4 Body style name patterns.
CONVERTIBLE_RE = re.compile(r"\b(convertible|cabriolet|cabrio|roadster|spider|spyder|volante)\b", re.IGNORECASE)
HATCHBACK_RE = re.compile(r"\b(hatchback|5-door|5dr|sportback|liftback)\b", re.IGNORECASE)
HATCHBACK_FAMILIES = frozenset({"gti", "golf", "golf r"})
VAN_RE = re.compile(r"\b(van|transit|promaster|sprinter|metris)\b", re.IGNORECASE)
COUPE_RE = re.compile(r"\bcoupe\b", re.IGNORECASE)
# 6.8 EPA test configurations a buyer cannot tell apart. A record without these is preferred as representative.
TEST_CONFIG_RE = re.compile(r"municipal|sport mode|stop-start", re.IGNORECASE)


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def _collapse_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _to_int(value: str | None) -> int | None:
    """EPA numbers arrive as strings such as "18" or "33.0". Zero and blanks mean "not applicable"."""
    try:
        number = int(round(float(value or "")))
    except ValueError:
        return None
    return number or None


@dataclass
class VariantRecord:
    """One normalized catalog variant, possibly merged from several EPA records."""

    make: str
    family: str
    model_year: int
    name: str
    trim_name: str | None
    body_style: str
    engine: str
    transmission: str
    drive_type: str
    fuel_type: str
    mpg_city: int | None
    mpg_highway: int | None
    mpg_combined: int | None
    ev_range_miles: int | None
    epa_vehicle_ids: list[str] = field(default_factory=list)
    source_payload: dict[str, Any] = field(default_factory=dict)

    @property
    def make_slug(self) -> str:
        return slugify(self.make)

    @property
    def model_slug(self) -> str:
        return slugify(self.family)

    @property
    def configuration(self) -> tuple:
        """The columns of uq_catalog_variants_configuration, apart from model_id."""
        return (self.model_year, self.name, self.engine, self.transmission, self.drive_type, self.fuel_type)

    @property
    def key(self) -> tuple:
        return (self.make_slug, self.model_slug, *self.configuration)


def is_excluded(row: dict[str, str]) -> bool:
    return bool(EXCLUDE_RE.search(row.get("model") or ""))


def clean_name(model: str) -> str:
    return _collapse_spaces(DRIVE_WORDS_RE.sub("", WHEELS_RE.sub("", model)))


def family_name(row: dict[str, str]) -> str:
    base = _collapse_spaces(row.get("baseModel") or "") or clean_name(row["model"]).split(" ")[0]
    if row.get("make") == "BMW" and base == "M":
        return row["model"].split()[0]  # BMW files the M2, M3, M4, M5 and M8 together under "M".
    return base


def trim_name(name: str, family: str) -> str | None:
    remainder = name[len(family) :] if name.lower().startswith(family.lower()) else name
    remainder = _collapse_spaces(TRIM_BODY_WORDS_RE.sub("", remainder))
    return remainder or None


def body_style(vehicle_class: str, name: str, family: str) -> str:
    vclass = vehicle_class.lower()
    if "sport utility" in vclass:
        return "SUV"
    if "pickup" in vclass:
        return "Truck"
    if "minivan" in vclass:
        return "Minivan"
    if "special purpose" in vclass:
        return "Van" if VAN_RE.search(name) else "SUV"
    if "wagon" in vclass:
        return "Wagon"
    if CONVERTIBLE_RE.search(name):
        return "Convertible"
    if HATCHBACK_RE.search(name) or family.lower() in HATCHBACK_FAMILIES:
        return "Hatchback"
    if COUPE_RE.search(name) and "gran coupe" not in name.lower():
        return "Coupe"
    if "two seater" in vclass:
        return "Coupe"
    return "Sedan"


def fuel_type(row: dict[str, str]) -> str:
    atv = (row.get("atvType") or "").strip()
    if atv == "EV":
        return "Electric"
    if atv == "Plug-in Hybrid":
        return "Plug-in hybrid"
    if atv == "Hybrid":
        return "Mild hybrid" if "mild" in (row.get("eng_dscr") or "").lower() else "Hybrid"
    if atv in {"FCV", "eFCV"}:
        return "Hydrogen"
    if atv == "Diesel" or (row.get("fuelType") or "") == "Diesel":
        return "Diesel"
    if atv == "FFV":
        return "Flex fuel"
    return "Gasoline"


def engine(row: dict[str, str], fuel: str) -> str:
    if fuel == "Electric":
        return "Electric motor"
    if fuel == "Hydrogen":
        return "Fuel cell"
    try:
        cylinders = int(float(row.get("cylinders") or ""))
        displacement = float(row.get("displ") or "")
    except ValueError:
        return "Not specified"
    text = f"{cylinders} cyl {displacement:.1f} L"
    if (row.get("tCharger") or "").strip():
        text += " Turbo"
    if (row.get("sCharger") or "").strip():
        text += " Supercharged"
    return text


def transmission(row: dict[str, str]) -> str:
    return "Manual" if (row.get("trany") or "").startswith("Manual") else "Automatic"


def drive_type(row: dict[str, str]) -> str | None:
    drive = (row.get("drive") or "").lower()
    if "all-wheel" in drive:
        return "AWD"
    if "4-wheel" in drive:
        return "4WD"
    if "front" in drive:
        return "FWD"
    if "rear" in drive or "2-wheel" in drive:
        return "RWD"
    return None


def ev_range(row: dict[str, str], fuel: str) -> int | None:
    if fuel == "Electric":
        return _to_int(row.get("range"))
    if fuel == "Plug-in hybrid":
        return _to_int(row.get("rangeA"))  # `range` is the combined gas and electric range for plug-ins.
    return None


def _epa_id_sort_key(epa_id: str) -> tuple[int, str]:
    return (int(epa_id), epa_id) if epa_id.isdigit() else (10**12, epa_id)


def normalize_row(row: dict[str, str]) -> VariantRecord | None:
    """Normalize one EPA row, or return None when it cannot be mapped to the catalog's allowed values."""
    drive = drive_type(row)
    if drive is None or not (row.get("make") or "").strip() or not (row.get("model") or "").strip():
        return None
    name = clean_name(row["model"])
    family = family_name(row)
    fuel = fuel_type(row)
    return VariantRecord(
        make=_collapse_spaces(row["make"]),
        family=family,
        model_year=int(row["year"]),
        name=name,
        trim_name=trim_name(name, family),
        body_style=body_style(row.get("VClass") or "", name, family),
        engine=engine(row, fuel),
        transmission=transmission(row),
        drive_type=drive,
        fuel_type=fuel,
        mpg_city=_to_int(row.get("city08")),
        mpg_highway=_to_int(row.get("highway08")),
        mpg_combined=_to_int(row.get("comb08")),
        ev_range_miles=ev_range(row, fuel),
        epa_vehicle_ids=[row["id"]],
        source_payload={"source": "epa_bulk", "record": {k: v for k, v in row.items() if v not in ("", None)}},
    )


@dataclass
class NormalizeReport:
    source_rows: int = 0
    excluded_rows: int = 0
    unmapped_rows: int = 0
    merged_groups: int = 0
    variants: list[VariantRecord] = field(default_factory=list)


def build_variants(rows: Iterable[dict[str, str]], years: set[int]) -> NormalizeReport:
    """Filter, normalize and merge EPA rows for the given model years (findings sections 6.1 to 6.8)."""
    report = NormalizeReport()
    groups: dict[tuple, list[tuple[dict[str, str], VariantRecord]]] = defaultdict(list)
    for row in rows:
        try:
            year = int(row.get("year") or 0)
        except ValueError:
            continue
        if year not in years:
            continue
        report.source_rows += 1
        if is_excluded(row):
            report.excluded_rows += 1
            continue
        record = normalize_row(row)
        if record is None:
            report.unmapped_rows += 1
            continue
        groups[record.key].append((row, record))

    for members in groups.values():
        if len(members) > 1:
            report.merged_groups += 1
        members.sort(key=lambda member: _epa_id_sort_key(member[0]["id"]))
        preferred = [member for member in members if not TEST_CONFIG_RE.search(member[0].get("eng_dscr") or "")]
        representative = (preferred or members)[0][1]
        representative.epa_vehicle_ids = sorted({member[0]["id"] for member in members}, key=_epa_id_sort_key)
        report.variants.append(representative)
    report.variants.sort(key=lambda record: record.key)
    return report
