from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # Primary search: Google Custom Search JSON API.
    google_api_key: str = ""
    google_cse_id: str = ""

    max_results: int = 10
    request_timeout_seconds: int = 20


# Domains we're willing to crawl for this learning project.
# Keep this list explicit rather than crawling anything a search engine returns.
ALLOWED_DOMAINS = [
    "tesla.com",
    "ford.com",
    "chevrolet.com",
    "toyota.com",
    "honda.com",
    "cars.com",
    "cargurus.com",
    "bmwusa.com",
]

# Maps a manufacturer name (as query_parser might extract it) to its domain in
# ALLOWED_DOMAINS, so search_resolver can search the relevant brand's site first
# instead of looping through every allowed domain in list order.
MAKE_DOMAIN_MAP = {
    "tesla": "tesla.com",
    "ford": "ford.com",
    "chevrolet": "chevrolet.com",
    "chevy": "chevrolet.com",
    "toyota": "toyota.com",
    "honda": "honda.com",
    "bmw": "bmwusa.com",
}

settings = Settings()
