from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIRECTORY = PROJECT_ROOT / "data"
UPLOAD_DIRECTORY = PROJECT_ROOT / "uploads"
DEFAULT_TERMS_VERSION = "2026-09-30"
SUPPORTED_ROLES = ("buyer", "dealer", "support", "admin")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=PROJECT_ROOT / ".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    app_name: str = "Deal&Drive API"
    api_prefix: str = "/api/v1"
    database_url: str = "sqlite+aiosqlite:///./data/drivedeal.db"
    jwt_secret_key: str = "local-development-secret-change-before-production"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60
    refresh_token_days: int = 14
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"])
    aws_region: str = "ap-south-1"
    s3_bucket: str = "drive-deal-dsu"
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    storage_driver: str = "local"
    auto_seed_demo: bool = False
    openai_api_key: str | None = None
    codex_oauth_access_token: str | None = None
    openai_model: str = "gpt-5.6-sol"
    openai_reasoning_effort: str = "medium"
    ai_provider: str = "openai"
    ai_disabled: bool = False
    ai_enable_web_search: bool = False
    ai_max_input_tokens: int = 12_000
    ai_max_output_tokens: int = 1_800
    ai_request_timeout_seconds: float = 45

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [entry.strip() for entry in value.split(",") if entry.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.is_production and len(settings.jwt_secret_key) < 32:
        raise ValueError("JWT_SECRET_KEY must contain at least 32 characters in production")
    return settings
