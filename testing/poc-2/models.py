"""Shared Pydantic schemas. Every stage of the pipeline appends a StageTiming entry and
(where applicable) a TokenUsage entry to the running QueryReport, so test_queries.py can
dump one self-contained JSON file per query with exactly how much time/tokens/method each
stage used and what it produced - that's the whole point of this POC.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field

SearchProvider = Literal["duckduckgo", "searxng"]
FetchMethod = Literal["static", "crawl4ai", "failed"]


class SearchResult(BaseModel):
    url: str
    title: str = ""
    snippet: str = ""
    provider: SearchProvider


class CandidateUrl(BaseModel):
    url: str
    canonical_url: str
    title: str = ""
    snippet: str = ""
    source_domain: str
    providers: list[SearchProvider] = Field(default_factory=list)  # which provider(s) returned this URL
    relevance_score: float = 0.0  # deterministic keyword score, see ranking.py - no LLM involved


class CrawlResult(BaseModel):
    url: str
    method: FetchMethod
    success: bool
    content_length: int = 0
    duration_ms: float = 0.0
    error: Optional[str] = None


class TokenUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0

    def __add__(self, other: "TokenUsage") -> "TokenUsage":
        return TokenUsage(
            input_tokens=self.input_tokens + other.input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
            total_tokens=self.total_tokens + other.total_tokens,
        )


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


class StageTiming(BaseModel):
    stage: str
    method: str = ""  # e.g. "duckduckgo+searxng", "static", "crawl4ai", "llm:gpt-4o-mini"
    duration_ms: float = 0.0
    detail: dict = Field(default_factory=dict)  # stage-specific extra info (counts, errors, etc.)
    tokens: Optional[TokenUsage] = None


class QueryReport(BaseModel):
    """The full, detailed record for a single query - this is what gets written to JSON."""

    query: str
    started_at: str
    finished_at: str = ""
    total_duration_ms: float = 0.0

    search_results: list[SearchResult] = Field(default_factory=list)
    candidates: list[CandidateUrl] = Field(default_factory=list)
    crawl_results: list[CrawlResult] = Field(default_factory=list)
    final_results: list[CarSpecs] = Field(default_factory=list)

    stages: list[StageTiming] = Field(default_factory=list)
    total_tokens: TokenUsage = Field(default_factory=TokenUsage)

    # Quick-glance end result, mirrors what the proposed architecture's "Answer Synthesis"
    # step would hand the user - here it's just the top candidates by data completeness.
    summary: dict = Field(default_factory=dict)

    errors: list[str] = Field(default_factory=list)
