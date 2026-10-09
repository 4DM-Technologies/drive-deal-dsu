"""Guided question planner: decides the next question of the card from the answers so far.

Deterministic and stateless. The client sends the answers back on every call; they are re-validated against the
catalog each time. Question flows (planning decisions):

- "I know the car I want" button: make, model, variant, model year, city and state, timeline
- A brand named ("I want a BMW"): body style, model, variant, model year, city and state, timeline
- A model named ("I want a BMW M3"): variant, model year, must-haves, city and state, timeline
- "Help me choose": body style, make, model, city and state, timeline

Budget is never a standard question. It is added right after the current question only when the buyer mentions
money, and filled in directly when they give an amount.
"""

import re
from dataclasses import dataclass
from difflib import SequenceMatcher, get_close_matches

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.guided import (
    GuidedAction,
    GuidedAnswers,
    GuidedCandidate,
    GuidedFilters,
    GuidedNextRequest,
    GuidedOption,
    GuidedQuestion,
    GuidedStep,
    QuestionId,
)
from src.repositories.schema import State
from src.services.catalog.matcher import YEAR_RE, MatchResult, match_message, parse_budget
from src.services.catalog.queries import CatalogQueries, MakeInfo, ModelInfo, VariantInfo

FLOWS: dict[str, list[QuestionId]] = {
    "button": ["make", "model", "variant", "model_year", "area", "timeline"],
    "make": ["body_style", "model", "variant", "model_year", "area", "timeline"],
    "model": ["variant", "model_year", "must_haves", "area", "timeline"],
    "explore": ["body_style", "make", "model", "area", "timeline"],
}
REQUIRED: set[QuestionId] = {"disambiguate", "make", "area", "timeline"}
TIMELINES = ("ASAP", "Within 1 week", "Within 2 weeks", "Just exploring")
OPEN_MODEL = "Open to recommendations"
BUDGET_OPTIONS = (
    ("0-30000", "Under $30k"),
    ("30000-50000", "$30k – $50k"),
    ("50000-75000", "$50k – $75k"),
    ("75000-100000", "$75k – $100k"),
    ("100000-", "Over $100k"),
)
MUST_HAVES = (
    "Leather seats",
    "Sunroof or moonroof",
    "Apple CarPlay / Android Auto",
    "Heated seats",
    "Adaptive cruise control",
    "360° camera",
    "Third-row seating",
    "Towing package",
)
EXPLORE_BODY_STYLES = (
    ("SUV", "Higher seating, room for family and cargo"),
    ("Sedan", "Four doors and a separate trunk"),
    ("Truck", "Open bed for hauling and towing"),
    ("Hatchback", "Compact, with a rear liftgate"),
    ("Coupe", "Two doors, sportier styling"),
    ("Convertible", "A roof that opens"),
    ("Wagon", "Car height with extra cargo space"),
    ("Minivan", "Sliding doors and seating for 7 or 8"),
)
TIMELINE_WORDS = (
    ("ASAP", re.compile(r"\b(asap|now|immediately|right away|today|this week|urgent)\b", re.I)),
    ("Within 2 weeks", re.compile(r"\b(2|two|couple of) weeks?\b|\bfortnight\b", re.I)),
    ("Within 1 week", re.compile(r"\b(1|one|a|next) week\b|\bweek\b", re.I)),
    ("Just exploring", re.compile(r"\b(explor\w*|not sure|no rush|later|months?|browsing|just looking)\b", re.I)),
)
STATE_SUFFIX_RE = re.compile(r"(?:,\s*|\s)([A-Za-z]{2})\.?\s*$")
STRICT_STATE_SUFFIX_RE = re.compile(r"(?:,\s*([A-Za-z]{2})|\s([A-Z]{2}))\.?\s*$")
FUEL_ORDER = ("Gasoline", "Mild hybrid", "Hybrid", "Plug-in hybrid", "Electric", "Diesel", "Flex fuel", "Hydrogen")


@dataclass
class Context:
    make: MakeInfo | None = None
    model: ModelInfo | None = None
    variant: VariantInfo | None = None


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def resolve_options(text: str, options: list[GuidedOption]) -> list[str]:
    """Map typed text to option values: a number, an exact label, a label inside the text, or a close spelling."""
    raw = text.strip()
    if raw.isdigit() and 1 <= int(raw) <= len(options) and not (len(raw) == 4 and raw.startswith("20")):
        return [options[int(raw) - 1].value]
    typed = _norm(raw)
    if not typed:
        return []
    for option in options:
        if typed in (_norm(option.label), _norm(option.value)):
            return [option.value]
    contained = [option for option in options if re.search(rf"\b{re.escape(_norm(option.label))}\b", typed)]
    if contained:
        return [max(contained, key=lambda option: len(option.label)).value]
    partial = [option for option in options if re.search(rf"\b{re.escape(typed)}\b", _norm(option.label))]
    if partial:
        return [max(partial, key=lambda option: SequenceMatcher(None, typed, _norm(option.label)).ratio()).value]
    labels = {_norm(option.label): option.value for option in options}
    close = get_close_matches(typed, list(labels), n=1, cutoff=0.75)
    return [labels[close[0]]] if close else []


def _plural(body_style: str) -> str:
    return {"SUV": "SUVs", "Truck": "trucks", "Minivan": "minivans"}.get(body_style, f"{body_style.lower()}s")


def _year_range(years: list[int]) -> str:
    return str(years[0]) if len(years) == 1 else f"{years[0]}–{years[-1]}"


class GuidedPlanner:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.catalog = CatalogQueries(session)

    # ----------------------------------------------------------------------------------------------- entry points

    async def from_match(self, match: MatchResult) -> GuidedStep | None:
        """Start the card from a chat message. None when the message names no requestable vehicle."""
        answers = GuidedAnswers()
        if match.candidates:
            linked = [(make, model) for make, model in match.candidates if make.linked]
            if not linked:
                return None
            answers.candidates = [
                GuidedCandidate(
                    make_slug=make.slug,
                    model_slug=model.slug if model else None,
                    label=f"{make.name} {model.name}" if model else make.name,
                )
                for make, model in linked
            ]
            answers.entry = "model" if all(model for _, model in linked) else "make"
        elif match.make:
            if not match.make.linked:
                return None
            answers.make_slug = match.make.slug
            answers.model_slug = match.model.slug if match.model else None
            answers.entry = "model" if match.model else "make"
        else:
            return None
        answers.model_year = match.model_year
        answers.timeline = match.timeline
        answers.filters = GuidedFilters(**match.filters)
        self._apply_budget(answers, match.budget_min, match.budget_max, match.budget_mentioned, None)
        return await self._advance(answers)

    async def next(self, request: GuidedNextRequest) -> GuidedStep:
        answers, action = request.answers.model_copy(deep=True), request.action
        await self._sanitize(answers)
        if action.type == "back":
            self._back(answers)
            return await self._advance(answers)
        current = await self._advance(answers)
        if action.type == "resume" or current.question is None:
            return current
        question = current.question
        if action.question_id and action.question_id != question.id:
            return current  # the card is out of date; show the question that is actually next
        if action.type == "skip":
            if question.skippable:
                self._record(answers, question.id, skipped=True)
                if question.id == "model":
                    answers.model_text = OPEN_MODEL
            return await self._advance(answers)
        return await self._answer(answers, question, action)

    # ---------------------------------------------------------------------------------------------------- answers

    async def _answer(self, answers: GuidedAnswers, question: GuidedQuestion, action: GuidedAction) -> GuidedStep:
        values = [value for value in action.values if value in {option.value for option in question.options}]
        text = (action.text or "").strip()
        message = None
        if text:
            match = await match_message(self.session, text)
            switched = await self._maybe_switch_vehicle(answers, question.id, match)
            if switched:
                return await self._advance(answers, switched)
            if match.has_question and not values:
                # A question typed into the card ("is the CR-V reliable?") goes to Sera, even when it names an
                # option; the card stays on the same question.
                return GuidedStep(answers=answers, question=question, unresolved=True)
            if not values and await self._fill_other_fields(answers, question.id, text):
                return await self._advance(answers)
            handled_budget = match.budget_mentioned and question.id != "budget"
            if handled_budget:
                low, high = parse_budget(text)
                self._apply_budget(answers, low, high, True, question.id)
            if not values:
                values, message = await self._resolve_text(answers, question, text, free_text=not handled_budget)
                if handled_budget and not values:
                    message = None  # the text was about money, not an answer to this question
            if not values and message is None:
                if match.has_question or not handled_budget:
                    return GuidedStep(answers=answers, question=question, unresolved=True)
        if not values:
            return await self._advance(answers, message)
        message = await self._store(answers, question.id, values) or message
        return await self._advance(answers, message)

    async def _fill_other_fields(self, answers: GuidedAnswers, qid: QuestionId, text: str) -> bool:
        """Text that answers a different, still-open question (a city, or "no rush") fills that question."""
        filled = False
        if qid != "area" and not self._satisfied("area", answers):
            location = await self._parse_location(text, strict=True)
            if location:
                answers.buyer_area, answers.state, answers.state_id = location
                self._record(answers, "area")
                filled = True
        if qid not in ("timeline", "must_haves") and not self._satisfied("timeline", answers):
            value = next((label for label, pattern in TIMELINE_WORDS if pattern.search(text)), None)
            if value and len(text.split()) <= 5:
                answers.timeline = value
                self._record(answers, "timeline")
                filled = True
        return filled

    async def _resolve_text(
        self, answers: GuidedAnswers, question: GuidedQuestion, text: str, *, free_text: bool = True
    ) -> tuple[list[str], str | None]:
        qid = question.id
        if qid == "area":
            location = await self._parse_location(text)
            if location is None:
                return [], "Please include a state, such as Austin, TX, so I can find dealers near you."
            answers.buyer_area, answers.state, answers.state_id = location
            return ["__area__"], None
        if qid == "budget":
            low, high = parse_budget(text)
            if high is None and low is None:
                digits = re.sub(r"[^\d.kKmM]", "", text)
                low, high = parse_budget(f"budget {digits}") if digits else (None, None)
            if high is None and low is None:
                return [], "Please type an amount, such as $45,000 or 45k."
            answers.budget_min, answers.budget_max = low, high
            return ["__budget__"], None
        if qid == "must_haves":
            items = [item.strip() for item in re.split(r",|;|\band\b", text) if item.strip()]
            known = resolve_options(text, question.options)
            answers.must_haves = list(dict.fromkeys([*known, *items]))[:12]
            return ["__must_haves__"], None
        if qid == "timeline":
            value = next((label for label, pattern in TIMELINE_WORDS if pattern.search(text)), None)
            return ([value], None) if value else (resolve_options(text, question.options), None)
        if qid == "model_year":
            years = [year for year in YEAR_RE.findall(text) if year in {option.value for option in question.options}]
            return (years[:1], None) if years else (resolve_options(text, question.options), None)
        resolved = resolve_options(text, question.options)
        if resolved:
            return resolved, None
        if qid == "make":
            match = await match_message(self.session, text)
            if match.make and not match.make.linked:
                return [], f"{match.make.name} isn’t in our dealer network yet. Please choose one of these brands."
        if (
            qid == "model"
            and free_text
            and len(text) >= 2
            and not (await match_message(self.session, text)).has_question
        ):
            answers.model_text = text[:120]
            return ["__model_text__"], None
        return [], None

    async def _store(self, answers: GuidedAnswers, qid: QuestionId, values: list[str]) -> str | None:
        value = values[0]
        if qid == "disambiguate":
            make_slug, _, model_slug = value.partition("|")
            make = await self.catalog.make(make_slug)
            if make is None or not make.linked:
                return "That brand isn’t in our dealer network yet. Please choose another option."
            answers.make_slug, answers.model_slug, answers.candidates = make_slug, model_slug or None, []
        elif qid == "make":
            answers.make_slug = value
        elif qid == "body_style":
            answers.body_style = value
        elif qid == "model":
            if value != "__model_text__":
                answers.model_slug, answers.model_text = value, None
        elif qid == "variant":
            answers.variant_id = value
        elif qid == "model_year":
            answers.model_year = int(value)
        elif qid == "budget" and value != "__budget__":
            low, _, high = value.partition("-")
            answers.budget_min = int(low) if low and low != "0" else None
            answers.budget_max = int(high) if high else None
        elif qid == "must_haves" and value != "__must_haves__":
            answers.must_haves = values[:12]
        elif qid == "timeline":
            answers.timeline = value
        self._record(answers, qid)
        return None

    async def _maybe_switch_vehicle(self, answers: GuidedAnswers, qid: QuestionId, match: MatchResult) -> str | None:
        """Typing a different vehicle restarts the vehicle questions and keeps location, timing and budget."""
        if qid in ("disambiguate", "make", "model") or match.make is None or match.candidates:
            return None
        if match.make.slug == answers.make_slug and (not match.model or match.model.slug == answers.model_slug):
            return None
        if not match.make.linked:
            return None
        keep = {"area", "timeline", "budget", "must_haves"}
        answers.make_slug = match.make.slug
        answers.model_slug = match.model.slug if match.model else None
        answers.model_text = answers.variant_id = answers.body_style = None
        answers.model_year = None
        answers.entry = "model" if match.model else "make"
        answers.filters = GuidedFilters(**match.filters)
        answers.answered = [qid for qid in answers.answered if qid in keep]
        answers.skipped = [qid for qid in answers.skipped if qid in keep]
        name = f"{match.make.name} {match.model.name}" if match.model else match.make.name
        return f"Switched to the {name}."

    @staticmethod
    def _apply_budget(
        answers: GuidedAnswers, low: int | None, high: int | None, mentioned: bool, after: QuestionId | None
    ) -> None:
        if low is not None or high is not None:
            answers.budget_min, answers.budget_max = low, high
        elif mentioned and not answers.budget_requested:
            answers.budget_requested, answers.budget_after = True, after

    @staticmethod
    def _record(answers: GuidedAnswers, qid: QuestionId, *, skipped: bool = False) -> None:
        if qid not in answers.answered:
            answers.answered.append(qid)
        if skipped and qid not in answers.skipped:
            answers.skipped.append(qid)

    @staticmethod
    def _back(answers: GuidedAnswers) -> None:
        if not answers.answered:
            return
        qid = answers.answered.pop()
        if qid in answers.skipped:
            answers.skipped.remove(qid)
        if qid == "make":
            answers.make_slug = answers.model_slug = answers.model_text = answers.variant_id = None
        elif qid == "body_style":
            answers.body_style = None
        elif qid == "model":
            answers.model_slug = answers.model_text = answers.variant_id = None
        elif qid == "variant":
            answers.variant_id = None
        elif qid == "model_year":
            answers.model_year = None
        elif qid == "budget":
            answers.budget_min = answers.budget_max = None
        elif qid == "must_haves":
            answers.must_haves = []
        elif qid == "area":
            answers.buyer_area = answers.state = answers.state_id = None
        elif qid == "timeline":
            answers.timeline = None

    async def _parse_location(self, text: str, *, strict: bool = False) -> tuple[str, str, str] | None:
        """City and state from text. Strict mode, used outside the location question, needs a full state name,
        a code after a comma ("Austin, tx") or an upper-case code ("Austin TX"), so "leather is ok" is not Oklahoma."""
        states = (
            await self.session.execute(select(State.id, State.name, State.code).where(State.is_active.is_(True)))
        ).all()
        lowered = text.lower()
        found = next((state for state in states if re.search(rf"\b{re.escape(state[1].lower())}\b", lowered)), None)
        if found is None:
            pattern = STRICT_STATE_SUFFIX_RE if strict else STATE_SUFFIX_RE
            suffix = pattern.search(text.strip())
            code = (suffix.group(1) or suffix.groups()[-1] or "").upper() if suffix else None
            found = next((state for state in states if state[2] == code), None)
        if found is None:
            return None
        return text.strip()[:180], found[1], found[0]

    # ----------------------------------------------------------------------------------------------- sequencing

    async def _sanitize(self, answers: GuidedAnswers) -> Context:
        """Drop anything that no longer matches the catalog, so client-supplied answers are never trusted."""
        context = Context()
        if answers.make_slug:
            context.make = await self.catalog.make(answers.make_slug)
            if context.make is None or not context.make.linked:
                answers.make_slug = answers.model_slug = answers.variant_id = None
                context.make = None
        if answers.model_slug:
            context.model = await self.catalog.model(answers.make_slug, answers.model_slug)
            if context.model is None:
                answers.model_slug = answers.variant_id = None
        if answers.variant_id:
            context.variant = await self.catalog.variant(answers.variant_id, answers.make_slug, answers.model_slug)
            if context.variant is None:
                answers.variant_id = None
        if answers.model_year and context.model and answers.model_year not in context.model.years:
            answers.model_year = None
        if answers.state_id and answers.state_id not in {
            row[0] for row in (await self.session.execute(select(State.id).where(State.id == answers.state_id))).all()
        }:
            answers.buyer_area = answers.state = answers.state_id = None
        return context

    @staticmethod
    def _sequence(answers: GuidedAnswers) -> list[QuestionId]:
        flow: list[QuestionId] = list(FLOWS[answers.entry])
        if answers.candidates or "disambiguate" in answers.answered:
            flow.insert(0, "disambiguate")
        if answers.budget_requested:
            anchor = answers.budget_after
            position = flow.index(anchor) + 1 if anchor in flow else (1 if answers.candidates else 0)
            flow.insert(position, "budget")
        return flow

    @staticmethod
    def _satisfied(qid: QuestionId, answers: GuidedAnswers) -> bool:
        if qid in answers.skipped:
            return True
        return {
            "disambiguate": not answers.candidates,
            "make": bool(answers.make_slug),
            "body_style": bool(answers.body_style or answers.model_slug or answers.model_text),
            "model": bool(answers.model_slug or answers.model_text),
            "variant": bool(answers.variant_id),
            "model_year": bool(answers.model_year),
            "budget": answers.budget_min is not None or answers.budget_max is not None,
            "must_haves": bool(answers.must_haves),
            "area": bool(answers.buyer_area and answers.state_id),
            "timeline": bool(answers.timeline),
        }[qid]

    async def _advance(self, answers: GuidedAnswers, message: str | None = None) -> GuidedStep:
        """Return the next question, filling in single-choice answers and skipping questions with no options."""
        auto_skipped: set[QuestionId] = set()  # recalculated on every call, so going back re-checks them
        for _ in range(12):
            context = await self._sanitize(answers)
            sequence = self._sequence(answers)
            pending = [qid for qid in sequence if qid not in auto_skipped and not self._satisfied(qid, answers)]
            if not pending:
                return GuidedStep(answers=answers, draft=await self._draft(answers, context), message=message)
            qid = pending[0]
            options = await self._options(qid, answers, context)
            if qid in ("variant", "model_year") and len(options) == 1:
                await self._store(answers, qid, [options[0].value])
                answers.answered.remove(qid)  # filled in automatically, so it is not counted as a question
                continue
            if not options and qid not in ("area", "budget", "must_haves") and qid not in REQUIRED:
                auto_skipped.add(qid)  # nothing to choose from, e.g. a model typed by hand
                continue
            asked = [item for item in answers.answered if item in sequence]
            question = GuidedQuestion(
                id=qid,
                title=self._title(qid, answers, context),
                options=options,
                allow_other=qid not in ("disambiguate",),
                other_placeholder=self._placeholder(qid),
                multi_select=qid == "must_haves",
                skippable=qid not in REQUIRED,
                index=len(asked) + 1,
                total=len(asked) + len(pending),
            )
            return GuidedStep(answers=answers, question=question, message=message)
        raise RuntimeError("guided planner did not converge")

    # ------------------------------------------------------------------------------------------ question content

    async def _options(self, qid: QuestionId, answers: GuidedAnswers, context: Context) -> list[GuidedOption]:
        if qid == "disambiguate":
            return [
                GuidedOption(value=f"{item.make_slug}|{item.model_slug or ''}", label=item.label)
                for item in answers.candidates
            ]
        if qid == "make":
            makes = await self.catalog.linked_makes(answers.body_style) or await self.catalog.linked_makes()
            suffix = f" {_plural(answers.body_style)}" if answers.body_style else " models"
            return [
                GuidedOption(value=make.slug, label=make.brand_name or make.name, description=f"{count}{suffix}")
                for make, count in makes
            ]
        if qid == "body_style":
            if context.make is None:
                return [GuidedOption(value=value, label=value, description=text) for value, text in EXPLORE_BODY_STYLES]
            return [
                GuidedOption(
                    value=body,
                    label=body,
                    description=", ".join(names[:5]) + (f" +{len(names) - 5} more" if len(names) > 5 else ""),
                )
                for body, names in await self.catalog.body_styles(context.make.slug)
            ]
        if qid == "model" and context.make:
            return [
                GuidedOption(
                    value=info.slug,
                    label=info.name,
                    description=f"{_year_range(info.years)} · "
                    + ", ".join(
                        sorted(info.fuel_types, key=lambda fuel: FUEL_ORDER.index(fuel) if fuel in FUEL_ORDER else 99)
                    ),
                )
                for info in await self.catalog.models(context.make.slug, answers.body_style)
            ]
        if qid == "variant" and context.make and context.model:
            filters = answers.filters.model_dump(exclude_none=True)
            if answers.body_style:
                filters["body_style"] = answers.body_style
            variants = await self.catalog.variants(context.make.slug, context.model.slug, answers.model_year, filters)
            return [GuidedOption(value=row.id, label=row.name, description=row.describe()) for row in variants]
        if qid == "model_year" and context.make and context.model:
            years = await self.catalog.model_years(context.make.slug, context.model.slug, context.variant)
            return [GuidedOption(value=str(year), label=str(year)) for year in years]
        if qid == "budget":
            return [GuidedOption(value=value, label=label) for value, label in BUDGET_OPTIONS]
        if qid == "must_haves":
            return [GuidedOption(value=item, label=item) for item in MUST_HAVES]
        if qid == "timeline":
            return [GuidedOption(value=item, label=item) for item in TIMELINES]
        return []

    @staticmethod
    def _title(qid: QuestionId, answers: GuidedAnswers, context: Context) -> str:
        make = context.make.brand_name or context.make.name if context.make else None
        model = context.model.name if context.model else None
        if qid == "disambiguate":
            return "Which one did you mean?"
        if qid == "make":
            return (
                f"Which brand of {_plural(answers.body_style)}?"
                if answers.body_style
                else "Which brand are you interested in?"
            )
        if qid == "body_style":
            return f"Which {make} body style are you after?" if make else "What kind of car are you looking for?"
        if qid == "model":
            if answers.body_style and make:
                return (
                    f"Which {make} {answers.body_style if answers.body_style == 'SUV' else answers.body_style.lower()}?"
                )
            return f"Which {make} model?" if make else "Which model?"
        if qid == "variant":
            return f"Which {model}?" if model else "Which version?"
        if qid == "model_year":
            return "Which model year?"
        if qid == "budget":
            return "What’s your budget?"
        if qid == "must_haves":
            return "Any must-have features?"
        if qid == "area":
            return "Where should dealers look?"
        return "When are you hoping to buy?"

    @staticmethod
    def _placeholder(qid: QuestionId) -> str:
        return {
            "area": "City, state (for example, Austin, TX)",
            "budget": "Type an amount, such as $45,000",
            "must_haves": "Add your own, separated by commas",
            "model": "Type a model",
            "make": "Type a brand",
        }.get(qid, "Something else…")

    # ------------------------------------------------------------------------------------------------------ draft

    async def _draft(self, answers: GuidedAnswers, context: Context) -> dict[str, str]:
        """The finished request in the review card's field names. Only filled fields are included."""
        variant = context.variant
        if variant and answers.model_year and context.make and context.model:
            variant = await self.catalog.variant_for_year(
                variant, context.make.slug, context.model.slug, answers.model_year
            )
        draft = {
            "brand": context.make.brand_name if context.make else None,
            "brandId": context.make.brand_id if context.make else None,
            "model": context.model.name if context.model else answers.model_text or OPEN_MODEL,
            "trim": variant.trim_name if variant else None,
            "years": str(answers.model_year) if answers.model_year else None,
            "bodyType": variant.body_style if variant else answers.body_style,
            "fuelType": variant.fuel_type if variant else answers.filters.fuel_type,
            "drivetrain": variant.drive_type if variant else answers.filters.drive_type,
            "transmission": variant.transmission if variant else answers.filters.transmission,
            "budgetMin": str(answers.budget_min) if answers.budget_min is not None else None,
            "budgetMax": str(answers.budget_max) if answers.budget_max is not None else None,
            "mustHaves": ", ".join(answers.must_haves) if answers.must_haves else None,
            "area": answers.buyer_area,
            "state": answers.state,
            "stateId": answers.state_id,
            "timeline": answers.timeline,
        }
        return {key: value for key, value in draft.items() if value}


def opening_message(step: GuidedStep, make: MakeInfo | None, model_count: int, model: ModelInfo | None) -> str:
    """Sera's one-line reply that introduces the card. A template, so the fast path makes no LLM call."""
    if step.answers.candidates:
        return "A couple of cars match that. Pick the one you meant and I’ll ask a few quick questions."
    if make and model:
        return f"Good choice, the {make.brand_name or make.name} {model.name}. A few quick questions so dealers can quote the right one."
    if make:
        return f"{make.brand_name or make.name} has {model_count} models in our catalog. A few quick questions to narrow it down."
    return "A few quick questions so I can build your request."
