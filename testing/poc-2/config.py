from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # --- Search providers ---
    # Both run concurrently by default; results are merged, tagged with their provider,
    # then deduplicated. Either one can fail independently without failing the query.
    enable_duckduckgo: bool = True
    enable_searxng: bool = True
    searxng_url: str = "http://localhost:8080"  # self-hosted instance, see README

    max_results_per_provider: int = 10
    max_crawl_candidates: int = 8  # how many deduped/ranked URLs actually get crawled

    request_timeout_seconds: int = 20
    crawl_timeout_seconds: int = 25

    # Cache TTL is a POC stand-in for the real design's SQLite+TTL cache (see parent doc,
    # section 18-19) - here it's just in-memory per process run, long enough to dedupe
    # repeat URLs within a single multi-query test batch.
    cache_ttl_seconds: int = 3600


# No domain allow-list - the new design crawls any public, robots.txt-permitting URL
# (see backend/src/agents/tools/web_search.py's `_domain_of`, which made the same call
# in production). Manufacturer-domain preference still helps rank candidates, though.
MAKE_DOMAIN_MAP = {
    "tesla": "tesla.com",
    "ford": "ford.com",
    "chevrolet": "chevrolet.com",
    "chevy": "chevrolet.com",
    "toyota": "toyota.com",
    "honda": "honda.com",
    "bmw": "bmwusa.com",
}

# Sites that never originate manufacturer/listing data but routinely outrank real sources
# for "<car> specs/for sale"-style queries.
EXCLUDED_REFERENCE_DOMAINS = ("wikipedia.org", "wikiwand.com", "pinterest.com", "youtube.com")

settings = Settings()
