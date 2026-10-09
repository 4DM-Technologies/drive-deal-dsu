from decimal import Decimal
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
LOCAL_DEVELOPMENT_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")
REQUEST_CONTEXT_SKIPPED_PATHS = frozenset({"/health", "/metrics"})
REQUEST_CONTEXT_LOGGED_METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE"})

# Marketplace state transitions
MARKETPLACE_DEAL_FLOW = ("paperwork_going_on", "funds_arrived", "dispatch", "delivery", "completed")

# Premium subscription rules. The dealer trial runs for two months from the first login and allows
# three quotes in total; the buyer free plan allows three car-buy posts for the lifetime of the
# account. Paying unlocks unlimited usage for one year from the payment timestamp.
DEALER_TRIAL_DAYS = 60
DEALER_TRIAL_QUOTE_LIMIT = 3
BUYER_FREE_REQUEST_LIMIT = 3
DEALER_PREMIUM_PRICE = Decimal("500")
BUYER_PREMIUM_PRICE = Decimal("100")
PREMIUM_DURATION_DAYS = 365
PREMIUM_CURRENCY = "USD"
PAYMENT_PLAN_BY_ROLE = {"dealer": "dealer_premium", "buyer": "buyer_premium"}
PREMIUM_PRICE_BY_ROLE = {"dealer": DEALER_PREMIUM_PRICE, "buyer": BUYER_PREMIUM_PRICE}

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
CODEX_OAUTH_REDIRECT_URI = f"http://{CODEX_OAUTH_REDIRECT_HOST}:{CODEX_OAUTH_REDIRECT_PORT}{CODEX_OAUTH_CALLBACK_PATH}"
CODEX_OAUTH_SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
CODEX_OAUTH_REFRESH_SKEW_SECONDS = 120
CODEX_OAUTH_HTTP_TIMEOUT_SECONDS = 30
CODEX_OAUTH_LEGACY_STATE_DIR = PROJECT_ROOT / ".codex_oauth_state"
CODEX_OAUTH_HOST_ID_FILE = "host_id.txt"
CODEX_OAUTH_CLIENT_ID_FILE = "client_id.txt"
CODEX_OAUTH_TOKENS_FILE = "tokens.json"

# A ChatGPT-OAuth-sourced credential (chatgpt_oauth_env/chatgpt_oauth_cache) talks to ChatGPT's own
# backend, not the public OpenAI API - different base URL, requires stream=true on every request,
# and Cloudflare 530s requests with no real User-Agent (verified via testing/codex-llm-test).
CODEX_DIRECT_BASE_URL = "https://chatgpt.com/backend-api/codex"
CODEX_DIRECT_USER_AGENT = "codex_cli_rs"

# OAuth 2.0 Device Authorization Grant (RFC 8628) - for signing in from a machine with no browser,
# or where the account approving sign-in is on someone else's already-logged-in browser. Verified
# live end-to-end via testing/codex-device-auth (request -> poll -> exchange all confirmed working).
# Reverse-engineered from the open-source Codex CLI (openai/codex, codex-rs/login/src/
# device_code_auth.rs + codex-rs/login/src/oauth/client.rs) since OpenAI has not published a
# device-flow API reference. Requires "Device code" sign-in enabled for the ChatGPT account/workspace.
CODEX_OAUTH_DEVICE_USERCODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode"
CODEX_OAUTH_DEVICE_TOKEN_POLL_URL = "https://auth.openai.com/api/accounts/deviceauth/token"
# Verified live: the final code->token exchange goes to "{issuer}/oauth/token", not the
# "/api/accounts/oauth/token" path CODEX_OAUTH_TOKEN_URL above uses for the browser flow.
CODEX_OAUTH_DEVICE_EXCHANGE_URL = "https://auth.openai.com/oauth/token"
# Where a human enters the user_code shown to them.
CODEX_OAUTH_DEVICE_VERIFICATION_URL = "https://auth.openai.com/codex/device"
# The device flow has no browser callback, so it uses this fixed redirect_uri instead of the
# localhost one above (confirmed in device_code_auth.rs: `format!("{base_url}/deviceauth/callback")`).
CODEX_OAUTH_DEVICE_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback"
CODEX_OAUTH_DEVICE_POLL_TIMEOUT_SECONDS = 15 * 60
CODEX_OAUTH_DEVICE_DEFAULT_POLL_INTERVAL_SECONDS = 5
# Verified live: Cloudflare returns 530 cf_route_error for a default/bot-looking User-Agent on the
# deviceauth endpoints - any real-looking value works.
CODEX_OAUTH_DEVICE_USER_AGENT = "codex_cli_rs"

WEB_SEARCH_USER_AGENT = "drivedeal-serra/1.0 (+web_search_agent)"
WEB_SEARCH_MAX_MARKDOWN_CHARS = 45_000

S3_PRESIGNED_URL_TTL_SECONDS = 900
S3_CACHE_CONTROL_NO_STORE = "no-store"
S3_SERVER_SIDE_ENCRYPTION = "AES256"

# Maps a manufacturer name to its official domain. web_search_agent has no site allow-list - it can crawl
# any public site - this is only used as a last-resort fallback URL when search providers return nothing.
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
    ai_enable_web_search: bool = True
    ai_max_input_tokens: int = 8_000
    ai_max_output_tokens: int = 1_800
    ai_request_timeout_seconds: float = 45
    web_search_max_results: int = 5
    web_search_market: str = "US"
    web_search_request_timeout_seconds: int = 8
    web_search_max_crawl_sites: int = 2
    web_search_max_retries: int = 3
    web_search_candidate_pool_size: int = 8
    web_search_min_score: float = 0.5
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
            origins = [entry.strip() for entry in value.split(",") if entry.strip()]
        elif isinstance(value, list):
            origins = value
        else:
            return value
        # Local Vite clients may use either host while calling a local or hosted API.
        return list(dict.fromkeys([*origins, *LOCAL_DEVELOPMENT_ORIGINS]))

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
