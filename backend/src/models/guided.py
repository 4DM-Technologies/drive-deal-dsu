"""Request and response contracts for the guided question card (POST /ai/guided/next).

The client holds the answers and sends them back on every call, so the planner keeps no server-side state. Every
value is re-validated against the catalog on each call; nothing in `answers` is trusted as-is.
"""

from typing import Literal

from pydantic import BaseModel, Field

QuestionId = Literal[
    "disambiguate", "make", "body_style", "model", "variant", "model_year", "budget", "must_haves", "area", "timeline"
]
Entry = Literal["button", "make", "model", "explore"]


class GuidedFilters(BaseModel):
    transmission: Literal["Automatic", "Manual"] | None = None
    fuel_type: Literal["Gasoline", "Mild hybrid", "Hybrid", "Plug-in hybrid", "Electric", "Diesel"] | None = None
    drive_type: Literal["AWD", "4WD", "FWD", "RWD"] | None = None


class GuidedCandidate(BaseModel):
    make_slug: str = Field(max_length=80)
    model_slug: str | None = Field(default=None, max_length=120)
    label: str = Field(max_length=200)


class GuidedAnswers(BaseModel):
    entry: Entry = "button"
    make_slug: str | None = Field(default=None, max_length=80)
    model_slug: str | None = Field(default=None, max_length=120)
    model_text: str | None = Field(default=None, max_length=120)
    variant_id: str | None = Field(default=None, max_length=36)
    body_style: str | None = Field(default=None, max_length=30)
    model_year: int | None = Field(default=None, ge=1984, le=2100)
    budget_min: int | None = Field(default=None, ge=0, le=100_000_000)
    budget_max: int | None = Field(default=None, ge=0, le=100_000_000)
    budget_requested: bool = False
    budget_after: QuestionId | None = None
    must_haves: list[str] = Field(default_factory=list, max_length=12)
    buyer_area: str | None = Field(default=None, max_length=180)
    state: str | None = Field(default=None, max_length=80)
    state_id: str | None = Field(default=None, max_length=36)
    timeline: Literal["ASAP", "Within 1 week", "Within 2 weeks", "Just exploring"] | None = None
    filters: GuidedFilters = Field(default_factory=GuidedFilters)
    candidates: list[GuidedCandidate] = Field(default_factory=list, max_length=8)
    answered: list[QuestionId] = Field(default_factory=list, max_length=20)
    skipped: list[QuestionId] = Field(default_factory=list, max_length=20)


class GuidedAction(BaseModel):
    type: Literal["resume", "answer", "skip", "back"] = "resume"
    question_id: QuestionId | None = None
    values: list[str] = Field(default_factory=list, max_length=12)
    text: str | None = Field(default=None, max_length=500)


class GuidedNextRequest(BaseModel):
    answers: GuidedAnswers = Field(default_factory=GuidedAnswers)
    action: GuidedAction = Field(default_factory=GuidedAction)


class GuidedOption(BaseModel):
    value: str
    label: str
    description: str | None = None


class GuidedQuestion(BaseModel):
    id: QuestionId
    title: str
    options: list[GuidedOption] = Field(default_factory=list)
    allow_other: bool = True
    other_placeholder: str = "Something else…"
    multi_select: bool = False
    skippable: bool = True
    index: int
    total: int


class GuidedStep(BaseModel):
    answers: GuidedAnswers
    question: GuidedQuestion | None = None
    draft: dict[str, str] | None = None
    message: str | None = None
    unresolved: bool = False
