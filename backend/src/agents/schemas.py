from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class OrchestratorPlan(BaseModel):
    """Strict output contract the orchestrator node's LLM call must satisfy. See orchestrator.md."""

    model_config = ConfigDict(extra="forbid")
    mode: Literal["kb_only", "web_direct", "web_per_car"]
    reasoning: str = ""


class CarSpecs(BaseModel):
    """Structured data extracted from a crawled car page (ported from testing/car-scraper-poc/models.py)."""

    source_url: str
    make: str | None = None
    model: str | None = None
    year: int | None = None
    trim: str | None = None
    price_usd: float | None = None
    mileage: int | None = None
    colors_available: list[str] = Field(default_factory=list)
    engine: str | None = None
    horsepower: int | None = None
    fuel_type: str | None = None
    transmission: str | None = None
    drivetrain: str | None = None
    seating_capacity: int | None = None
    extra_specs: dict[str, str] = Field(default_factory=dict)


class CandidateUrl(BaseModel):
    url: str
    source_domain: str
    title: str = ""
