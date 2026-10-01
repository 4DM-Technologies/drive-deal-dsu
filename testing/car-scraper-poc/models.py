from typing import Optional

from pydantic import BaseModel, Field


class CarQueryIntent(BaseModel):
    """Structured intent parsed from a free-text user query."""

    make: Optional[str] = Field(None, description="Car manufacturer, e.g. Tesla")
    model: Optional[str] = Field(None, description="Car model, e.g. Model 3")
    max_price: Optional[float] = Field(None, description="Max budget in USD, if mentioned")
    min_price: Optional[float] = Field(None, description="Min budget in USD, if mentioned")
    body_type: Optional[str] = Field(None, description="e.g. sedan, SUV, truck")
    top_n: int = Field(5, description="How many results the user wants")
    country_market: str = Field("US", description="Market constraint, always US for this project")


class CandidateUrl(BaseModel):
    url: str
    source_domain: str
    title: str = ""


class CarSpecs(BaseModel):
    """Structured data extracted from a crawled car page."""

    source_url: str
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    trim: Optional[str] = None
    price_usd: Optional[float] = None
    mileage: Optional[int] = None
    colors_available: list[str] = Field(default_factory=list)
    engine: Optional[str] = None
    horsepower: Optional[int] = None
    fuel_type: Optional[str] = None
    transmission: Optional[str] = None
    drivetrain: Optional[str] = None
    seating_capacity: Optional[int] = None
    extra_specs: dict[str, str] = Field(default_factory=dict)
