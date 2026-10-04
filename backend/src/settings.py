from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIRECTORY = PROJECT_ROOT / "data"
UPLOAD_DIRECTORY = PROJECT_ROOT / "uploads"
DEFAULT_TERMS_VERSION = "2026-09-30"
SUPPORTED_ROLES = ("buyer", "dealer", "support", "support-admin", "admin")

# API identity and middleware defaults
API_TITLE = "DriveDeal API"
API_VERSION = "1.0.0"
API_DESCRIPTION = "Reverse vehicle marketplace and Serra buyer advisor API."
API_CORS_METHODS = ("*",)
API_CORS_HEADERS = ("*",)
API_EXPOSE_HEADERS = ("Content-Disposition",)
REQUEST_CONTEXT_SKIPPED_PATHS = frozenset({"/health", "/metrics"})
REQUEST_CONTEXT_LOGGED_METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE"})

# Marketplace state transitions
MARKETPLACE_DEAL_FLOW = ("paperwork_going_on", "funds_arrived", "dispatch", "delivery", "completed")

# Administrator-managed AI configuration identifiers
ADMIN_WORKFLOW_KEY = "sera-main"
ADMIN_THEME_KEY = "global"
AI_REASONING_EFFORTS = ("minimal", "low", "medium", "high", "xhigh")

# Structured logging and function-flow tracing
LOG_LEVEL = "INFO"
LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")
LOG_FLOW_LAYERS = ("middleware", "route", "service", "repository", "agent")
LOG_FLOW_MAX_ARGS = 12
LOG_FLOW_ARG_VALUE_LIMIT = 64
LOG_FLOW_SENSITIVE_PARAMS = ("password", "token", "secret", "api_key", "apikey", "authorization", "cookie")
LOG_QUERY_STRING = True
LOGGER_NAME = "drivedeal"
LOG_FLOW_SKIPPED_ARG_NAMES = frozenset({"self", "cls", "request", "response", "websocket", "background_tasks"})
LOG_FLOW_SKIPPED_FUNCTION_NAMES = frozenset({"__repr__", "__str__", "__eq__", "__hash__"})
LOG_FLOW_LOGGED_ATTRIBUTE = "__drivedeal_log_flow__"
LOG_FLOW_EVENT_ENTRY = "function_entry"
LOG_FLOW_EVENT_EXIT = "function_exit"
LOG_FLOW_EVENT_ERROR = "function_error"
LOG_FLOW_OUTCOME_OK = "ok"
LOG_FLOW_OUTCOME_ERROR = "error"
LOG_FLOW_OUTCOME_CANCELLED = "cancelled"
LOG_FLOW_REDACTED_VALUE = "***"

# External service protocol and operational constants. Credentials and deployment-specific
# locations remain Settings fields and must be supplied through the environment.
CODEX_OAUTH_AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize"
CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token"
CODEX_OAUTH_BOOTSTRAP_CLIENT_ID = "dynamic_agent_client"
CODEX_OAUTH_RESOURCE = "https://api.openai.com/v1"
CODEX_OAUTH_REDIRECT_HOST = "127.0.0.1"
CODEX_OAUTH_REDIRECT_PORT = 1455
CODEX_OAUTH_CALLBACK_PATH = "/auth/callback"
CODEX_OAUTH_REDIRECT_URI = (
    f"http://{CODEX_OAUTH_REDIRECT_HOST}:{CODEX_OAUTH_REDIRECT_PORT}{CODEX_OAUTH_CALLBACK_PATH}"
)
CODEX_OAUTH_SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
CODEX_OAUTH_REFRESH_SKEW_SECONDS = 120
CODEX_OAUTH_HTTP_TIMEOUT_SECONDS = 30
CODEX_OAUTH_LEGACY_STATE_DIR = PROJECT_ROOT / ".codex_oauth_state"
CODEX_OAUTH_HOST_ID_FILE = "host_id.txt"
CODEX_OAUTH_CLIENT_ID_FILE = "client_id.txt"
CODEX_OAUTH_TOKENS_FILE = "tokens.json"

WEB_SEARCH_USER_AGENT = "drivedeal-serra/1.0 (+web_search_agent)"
WEB_SEARCH_MAX_MARKDOWN_CHARS = 45_000

S3_PRESIGNED_URL_TTL_SECONDS = 900
S3_CACHE_CONTROL_NO_STORE = "no-store"
S3_SERVER_SIDE_ENCRYPTION = "AES256"

# Domains the web_search_agent is willing to crawl. Keep explicit rather than crawling
# anything a search engine returns (ported from testing/car-scraper-poc/config.py).
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

# Maps a manufacturer name to its domain in ALLOWED_DOMAINS so a brand-specific query
# searches the relevant brand's site first instead of looping through every allowed
# domain in list order.
MAKE_DOMAIN_MAP = {
    "tesla": "tesla.com",
    "ford": "ford.com",
    "chevrolet": "chevrolet.com",
    "chevy": "chevrolet.com",
    "toyota": "toyota.com",
    "honda": "honda.com",
    "bmw": "bmwusa.com",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=PROJECT_ROOT / ".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    app_name: str = "Deal&Drive API"
    api_prefix: str = "/api/v1"
    database_url: str
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60
    refresh_token_days: int = 14
    cors_origins: list[str]
    aws_region: str | None = None
    s3_bucket: str | None = None
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    storage_driver: str = "local"
    openai_api_key: str | None = None
    codex_oauth_access_token: str | None = None
    codex_oauth_client_id: str | None = None
    codex_oauth_refresh_token: str | None = None
    codex_oauth_s3_prefix: str = "private/codex-oauth"
    openai_model: str = "gpt-6-luna"
    openai_reasoning_effort: str = "medium"
    ai_provider: str = "openai"
    ai_disabled: bool = False
    ai_enable_web_search: bool = False
    ai_max_input_tokens: int = 12_000
    ai_max_output_tokens: int = 1_800
    ai_request_timeout_seconds: float = 45
    google_api_key: str | None = None
    google_cse_id: str | None = None
    web_search_max_results: int = 5
    web_search_request_timeout_seconds: int = 20
    langsmith_tracing: bool = False
    langsmith_api_key: str | None = None
    langsmith_project: str = "drivedeal-serra"
    langsmith_endpoint: str | None = None
    log_level: str = LOG_LEVEL
    log_flow_enabled: bool = True

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [entry.strip() for entry in value.split(",") if entry.strip()]
        return value

    @field_validator("log_level", mode="before")
    @classmethod
    def normalize_log_level(cls, value: object) -> object:
        level = str(value).upper()
        if level not in LOG_LEVELS:
            raise ValueError(f"LOG_LEVEL must be one of {LOG_LEVELS}, received {value!r}")
        return level

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    def require_s3_location(self) -> tuple[str, str]:
        if not self.aws_region or not self.s3_bucket:
            raise ValueError("AWS_REGION and S3_BUCKET are required for S3-backed storage")
        return self.aws_region, self.s3_bucket


def validate_settings(settings: Settings) -> Settings:
    if len(settings.jwt_secret_key) < 32:
        raise ValueError("JWT_SECRET_KEY must contain at least 32 characters")
    if not settings.cors_origins:
        raise ValueError("CORS_ORIGINS must contain at least one allowed application origin")
    if settings.is_production and settings.storage_driver != "s3":
        raise ValueError(
            "STORAGE_DRIVER must be 's3' in production so quote media is never written to the application filesystem"
        )
    if settings.storage_driver == "s3" and (not settings.aws_region or not settings.s3_bucket):
        raise ValueError("AWS_REGION and S3_BUCKET are required when STORAGE_DRIVER is 's3'")
    return settings


@lru_cache
def get_settings() -> Settings:
    return validate_settings(Settings())
