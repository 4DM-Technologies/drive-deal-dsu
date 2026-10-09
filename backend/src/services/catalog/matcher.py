"""Find catalog vehicles and buying details in a buyer's message, without an LLM.

The catalog's 400-odd make and model names are loaded once and cached for an hour. Matching is token based: a
model matches only as whole words ("M3" matches "bmw m3" but not "m340i"), with spelling-tolerant matching for
longer words ("toyta camry").
"""

import re
import time
from dataclasses import dataclass, field
from difflib import get_close_matches

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.agents.requirements import BUDGET_RE, TIMELINES, _normalize_budget
from src.repositories.schema import CatalogMake, CatalogModel, CatalogVariant

CACHE_SECONDS = 3600

# Common nicknames, kept in code instead of a table (planning decision).
NICKNAMES = {
    "bimmer": "bmw",
    "beemer": "bmw",
    "beamer": "bmw",
    "chevy": "chevrolet",
    "merc": "mercedes-benz",
    "mercedes": "mercedes-benz",
    "benz": "mercedes-benz",
    "vw": "volkswagen",
    "vdub": "volkswagen",
    "caddy": "cadillac",
    "lambo": "lamborghini",
    "alfa": "alfa-romeo",
    "aston": "aston-martin",
    "rolls": "rolls-royce",
    "jag": "jaguar",
    "landrover": "land-rover",
    "hyundia": "hyundai",
    "mazada": "mazda",
}
# Model names that are also everyday words. They only match when the make is named too.
COMMON_WORD_MODELS = frozenset(
    {
        "escape",
        "edge",
        "ranger",
        "pilot",
        "passport",
        "ghost",
        "venue",
        "soul",
        "leaf",
        "cross",
        "sport",
        "limited",
        "touring",
        "one",
        "go",
        "fit",
        "eclipse",
        "journey",
        "dawn",
        "express",
        "transit",
        "kicks",
        "genesis",
        "ram",
        "rogue",
    }
)
# Make names that are also everyday words. They count as a make unless a body word follows ("a mini SUV").
GENERIC_MAKE_WORDS = {"mini": re.compile(r"\bmini\s*-?\s*(suv|van|truck|crossover|car|cars|vehicle|ute)\b", re.I)}
BUY_INTENT_RE = re.compile(
    r"\b(want|wanna|looking for|look for|buy|buying|purchase|purchasing|lease|leasing|interested in|"
    r"shopping for|need|in the market for|thinking (?:of|about)|planning (?:to|on))\b",
    re.IGNORECASE,
)
QUESTION_START_RE = re.compile(
    r"^\s*(what|which|how|why|when|where|is|are|does|do|did|should|can|could|would|will|tell me|explain)\b",
    re.IGNORECASE,
)
QUESTION_WORDS_RE = re.compile(
    r"\b(vs\.?|versus|compare|comparison|worth|reliab\w*|review\w*|problem\w*|issues?|specs?|specifications|"
    r"horsepower|hp|torque|mpg|mileage|range|safety|insurance|maintenance|better|best|recommend\w*|"
    r"differen\w*|pros|cons|tell me|explain)\b",
    re.IGNORECASE,
)
MONEY_RE = re.compile(
    r"\b(budget|price|prices|pricing|priced|cost|costs|afford|affordable|cheap|cheaper|cheapest|expensive|"
    r"inexpensive|how much|payments?|monthly|financ\w*|money|msrp|spend)\b",
    re.IGNORECASE,
)
DOLLAR_AMOUNT_RE = re.compile(r"(?:\$\s?(\d[\d,]*(?:\.\d+)?\s?[kKmM]?)|\b(\d{2,3}(?:\.\d+)?\s?[kK])\b)")
BETWEEN_RE = re.compile(
    r"\b(?:between|from)\s*\$?\s*(\d[\d,]*(?:\.\d+)?\s?[kKmM]?)\s*(?:and|to|-)\s*\$?\s*(\d[\d,]*(?:\.\d+)?\s?[kKmM]?)",
    re.IGNORECASE,
)
YEAR_RE = re.compile(r"\b(20[2-3]\d)\b")
EXTERIOR_COLOR_RE = re.compile(r"\b(black|white|silver|gray|grey|red|blue|green|brown|orange|yellow|gold)\b", re.I)
TRANSMISSION_WORDS = (
    ("Manual", re.compile(r"\b(manual|stick ?shift|stick)\b", re.I)),
    ("Automatic", re.compile(r"\b(automatic|auto)\b", re.I)),
)
FUEL_WORDS = (
    ("Plug-in hybrid", re.compile(r"\b(plug-?in(?: hybrid)?|phev)\b", re.I)),
    ("Electric", re.compile(r"\b(electric|ev|bev)\b", re.I)),
    ("Hybrid", re.compile(r"(?<!mild )\b(hybrid|hev)\b", re.I)),
    ("Diesel", re.compile(r"\bdiesel\b", re.I)),
)
DRIVE_WORDS = (
    ("AWD", re.compile(r"\b(awd|all-wheel(?: drive)?|all wheel drive)\b", re.I)),
    ("4WD", re.compile(r"\b(4wd|4x4|four-wheel drive|4-wheel drive)\b", re.I)),
    ("RWD", re.compile(r"\b(rwd|rear-wheel(?: drive)?|rear wheel drive)\b", re.I)),
    ("FWD", re.compile(r"\b(fwd|front-wheel(?: drive)?|front wheel drive)\b", re.I)),
)
FILLER_WORDS = frozenset(
    {
        "i",
        "a",
        "an",
        "the",
        "my",
        "me",
        "for",
        "to",
        "new",
        "car",
        "cars",
        "vehicle",
        "one",
        "please",
        "some",
        "im",
        "i'm",
        "am",
        "about",
        "of",
        "on",
        "in",
        "and",
        "or",
        "it",
        "this",
        "that",
        "with",
        "model",
    }
)


# Buying details that do not make a message "about something else" ("BMW X5 hybrid under 70k").
DETAIL_WORDS = frozenset(
    {
        "between",
        "under",
        "below",
        "around",
        "about",
        "max",
        "maximum",
        "budget",
        "up",
        "less",
        "than",
        "k",
        "and",
        "manual",
        "automatic",
        "auto",
        "stick",
        "hybrid",
        "electric",
        "ev",
        "plug",
        "phev",
        "diesel",
        "awd",
        "4wd",
        "rwd",
        "fwd",
        "all",
        "wheel",
        "drive",
        "asap",
        "within",
        "week",
        "weeks",
        "just",
        "exploring",
        "used",
        "for",
    }
)


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _key(text: str) -> str:
    return "".join(_tokens(text))


@dataclass(frozen=True)
class MakeEntry:
    slug: str
    name: str
    linked: bool


@dataclass(frozen=True)
class ModelEntry:
    make_slug: str
    slug: str
    name: str
    key: str


@dataclass
class CatalogIndex:
    makes: dict[str, MakeEntry]
    models: list[ModelEntry]
    # First word of variant names that belongs to exactly one model of a make: {"bmw": {"m340i": <3 Series>}}.
    variant_words: dict[str, dict[str, ModelEntry]] = field(default_factory=dict)
    make_keys: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for make in self.makes.values():
            self.make_keys[_key(make.name)] = make.slug
            self.make_keys[make.slug.replace("-", "")] = make.slug


_cache: tuple[float, CatalogIndex] | None = None


def invalidate_catalog_index() -> None:
    global _cache
    _cache = None


async def load_catalog_index(session: AsyncSession) -> CatalogIndex:
    global _cache
    if _cache and time.monotonic() - _cache[0] < CACHE_SECONDS:
        return _cache[1]
    make_rows = (
        await session.execute(
            # A make is in the dealer network when the catalog sync linked it to a marketplace brand.
            select(CatalogMake.id, CatalogMake.slug, CatalogMake.name, CatalogMake.brand_id).where(
                CatalogMake.is_active.is_(True)
            )
        )
    ).all()
    makes = {
        slug: MakeEntry(slug=slug, name=name, linked=brand_id is not None) for _, slug, name, brand_id in make_rows
    }
    slug_by_id = {make_id: slug for make_id, slug, _, _ in make_rows}
    model_rows = (
        await session.execute(
            select(CatalogModel.make_id, CatalogModel.slug, CatalogModel.name).where(CatalogModel.is_active.is_(True))
        )
    ).all()
    models = [
        ModelEntry(make_slug=slug_by_id[make_id], slug=slug, name=name, key=_key(name))
        for make_id, slug, name in model_rows
        if make_id in slug_by_id and _key(name)
    ]
    model_by_id = {
        model_id: ModelEntry(make_slug=slug_by_id[make_id], slug=slug, name=name, key=_key(name))
        for model_id, make_id, slug, name in (
            await session.execute(
                select(CatalogModel.id, CatalogModel.make_id, CatalogModel.slug, CatalogModel.name).where(
                    CatalogModel.is_active.is_(True)
                )
            )
        ).all()
        if make_id in slug_by_id
    }
    owners: dict[tuple[str, str], set[str]] = {}
    for model_id, variant_name in (
        await session.execute(
            select(CatalogVariant.model_id, CatalogVariant.name).where(CatalogVariant.is_active.is_(True)).distinct()
        )
    ).all():
        model = model_by_id.get(model_id)
        words = _tokens(variant_name)
        if model and words and len(words[0]) >= 3 and any(char.isdigit() for char in words[0]):
            owners.setdefault((model.make_slug, words[0]), set()).add(model_id)
    variant_words: dict[str, dict[str, ModelEntry]] = {}
    for (make_slug, word), model_ids in owners.items():
        if len(model_ids) == 1:
            variant_words.setdefault(make_slug, {})[word] = model_by_id[next(iter(model_ids))]
    index = CatalogIndex(makes=makes, models=models, variant_words=variant_words)
    _cache = (time.monotonic(), index)
    return index


@dataclass
class MatchResult:
    make: MakeEntry | None = None
    model: ModelEntry | None = None
    candidates: list[tuple[MakeEntry, ModelEntry | None]] = field(default_factory=list)
    buying_intent: bool = False
    has_question: bool = False
    budget_mentioned: bool = False
    budget_min: int | None = None
    budget_max: int | None = None
    model_year: int | None = None
    timeline: str | None = None
    filters: dict[str, str] = field(default_factory=dict)
    must_haves: list[str] = field(default_factory=list)

    @property
    def has_vehicle(self) -> bool:
        return self.make is not None or bool(self.candidates)

    @property
    def opens_card(self) -> bool:
        """Buying intent about a catalog vehicle: the guided card should open."""
        return self.has_vehicle and self.buying_intent

    @property
    def card_only(self) -> bool:
        """Nothing else was asked, so the card can answer without the LLM pipeline."""
        return self.opens_card and not self.has_question


def _phrases(tokens: list[str], longest: int = 4) -> dict[str, tuple[int, int]]:
    """Every run of 1..longest consecutive tokens, joined, mapped to its token span."""
    found: dict[str, tuple[int, int]] = {}
    for start in range(len(tokens)):
        for length in range(1, longest + 1):
            if start + length <= len(tokens):
                found.setdefault("".join(tokens[start : start + length]), (start, start + length))
    return found


def _amount(raw: str) -> int | None:
    value = _normalize_budget(raw)
    return int(value) if value else None


def parse_budget(text: str) -> tuple[int | None, int | None]:
    """(min, max) from text such as "under 45k", "$60,000" or "between 40 and 60k"."""
    between = BETWEEN_RE.search(text)
    if between:
        low, high = _amount(between.group(1)), _amount(between.group(2))
        if low and high and low < 1000 <= high:  # "40-60k" means 40k to 60k
            low *= 1000
        if low and high:
            return (min(low, high), max(low, high))
    keyword = BUDGET_RE.search(text)
    if keyword and (value := _amount(keyword.group(1))):
        return (None, value)
    dollar = DOLLAR_AMOUNT_RE.search(text)
    if dollar and (value := _amount(dollar.group(1) or dollar.group(2))):
        return (None, value)
    return (None, None)


def _find_makes(
    tokens: list[str], phrases: dict[str, tuple[int, int]], index: CatalogIndex
) -> dict[str, tuple[int, int]]:
    found: dict[str, tuple[int, int]] = {}
    for phrase, span in phrases.items():
        slug = index.make_keys.get(phrase) or NICKNAMES.get(phrase)
        if slug in index.makes:
            found.setdefault(slug, span)
    single_word_makes = {key: slug for key, slug in index.make_keys.items() if len(key) >= 4}
    for position, token in enumerate(tokens):
        if len(token) < 4 or token in FILLER_WORDS or any(start <= position < end for start, end in found.values()):
            continue
        close = get_close_matches(token, list(single_word_makes), n=1, cutoff=0.8)
        if close:
            found.setdefault(single_word_makes[close[0]], (position, position + 1))
    return found


def _usable_without_make(model: ModelEntry) -> bool:
    """An everyday word or a bare number is only a model when its make is named too."""
    if model.key in COMMON_WORD_MODELS or model.key.isdigit():
        return False
    # Two letters alone ("IS", "ES", "UX") read as ordinary words; "M3" and "Q7" are safe because of the digit.
    return len(model.key) > 2 or (len(model.key) == 2 and not model.key.isalpha())


def _find_models(
    tokens: list[str], phrases: dict[str, tuple[int, int]], index: CatalogIndex, make_slugs: set[str]
) -> list[tuple[ModelEntry, tuple[int, int]]]:
    # (model, token span, whether its make was named). Models of makes that were not named still count, so
    # "X5 vs Audi Q7" finds both, but only when the model name cannot be an everyday word.
    found: list[tuple[ModelEntry, tuple[int, int], bool]] = []
    for model in index.models:
        span = phrases.get(model.key)
        if span is None:
            continue
        scoped = model.make_slug in make_slugs
        if scoped or _usable_without_make(model):
            found.append((model, span, scoped))
    if not any(scoped for _, _, scoped in found) and make_slugs:
        named = [model for model in index.models if model.make_slug in make_slugs]
        by_key = {model.key: model for model in named if len(model.key) >= 4}
        used = {position for _, (start, end), _ in found for position in range(start, end)}
        for position, token in enumerate(tokens):
            if len(token) < 4 or position in used:
                continue
            close = get_close_matches(token, list(by_key), n=1, cutoff=0.85)
            if close:
                found.append((by_key[close[0]], (position, position + 1), True))
        if not any(scoped for _, _, scoped in found):
            # Variant-level names such as "330i" or "M340i" point to their model when the make is named.
            for make_slug in make_slugs:
                for position, token in enumerate(tokens):
                    model = index.variant_words.get(make_slug, {}).get(token)
                    if model:
                        found.append((model, (position, position + 1), True))

    def inside_longer(span: tuple[int, int]) -> bool:
        # "Corolla" inside "Corolla Cross", "Highlander" inside "Grand Highlander"
        return any(other[0] <= span[0] and span[1] <= other[1] and other != span for _, other, _ in found)

    kept = [(model, span, scoped) for model, span, scoped in found if not inside_longer(span)]
    # When two makes claim the same words, the make the buyer named wins.
    scoped_spans = {span for _, span, scoped in kept if scoped}
    return [(model, span) for model, span, scoped in kept if scoped or span not in scoped_spans]


def match_text(text: str, index: CatalogIndex) -> MatchResult:
    tokens = _tokens(text)
    phrases = _phrases(tokens)
    result = MatchResult()
    makes = _find_makes(tokens, phrases, index)
    for slug, generic_use in GENERIC_MAKE_WORDS.items():
        if slug in makes and generic_use.search(text):
            del makes[slug]
    models = _find_models(tokens, phrases, index, set(makes))
    used = set()
    for _, (start, end) in makes.items():
        used.update(range(start, end))
    for _, (start, end) in models:
        used.update(range(start, end))

    pairs: list[tuple[MakeEntry, ModelEntry | None]] = []
    if models:
        pairs = [(index.makes[model.make_slug], model) for model, _ in models]
    elif makes:
        pairs = [(index.makes[slug], None) for slug in makes]
    unique_pairs = list({(make.slug, model.slug if model else None): (make, model) for make, model in pairs}.values())
    if len(unique_pairs) == 1:
        result.make, result.model = unique_pairs[0]
    elif unique_pairs:
        result.candidates = unique_pairs

    low, high = parse_budget(text)
    result.budget_min, result.budget_max = low, high
    result.budget_mentioned = bool(MONEY_RE.search(text)) or high is not None or low is not None
    years = [int(year) for year in YEAR_RE.findall(text)]
    result.model_year = years[0] if years else None
    lowered = text.lower()
    result.timeline = next((timeline for timeline in TIMELINES if timeline.lower() in lowered), None)
    result.must_haves = list(
        dict.fromkeys(f"Exterior color: {match.group(1).title()}" for match in EXTERIOR_COLOR_RE.finditer(text))
    )
    for column, patterns in (
        ("transmission", TRANSMISSION_WORDS),
        ("fuel_type", FUEL_WORDS),
        ("drive_type", DRIVE_WORDS),
    ):
        value = next((label for label, pattern in patterns if pattern.search(text)), None)
        if value:
            result.filters[column] = value

    residual = [
        token
        for position, token in enumerate(tokens)
        if position not in used
        and token not in FILLER_WORDS
        and token not in DETAIL_WORDS
        and not any(char.isdigit() for char in token)
    ]
    result.has_question = "?" in text or bool(QUESTION_START_RE.search(text)) or bool(QUESTION_WORDS_RE.search(text))
    # A bare vehicle name ("BMW M3") is a buying signal on its own.
    result.buying_intent = bool(BUY_INTENT_RE.search(text)) or (
        result.has_vehicle and len(residual) <= 2 and not result.has_question
    )
    return result


async def match_message(session: AsyncSession, text: str) -> MatchResult:
    return match_text(text, await load_catalog_index(session))
