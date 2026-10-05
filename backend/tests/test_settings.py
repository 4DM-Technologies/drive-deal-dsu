import pytest
from pydantic import ValidationError

from src.settings import Settings, validate_settings


def local_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "database_url": "sqlite+aiosqlite:///./data/test.db",
        "jwt_secret_key": "test-only-secret-that-is-at-least-32-characters",
        "cors_origins": ["http://testserver"],
        "storage_driver": "local",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_settings_accept_valid_local_configuration() -> None:
    settings = validate_settings(local_settings())

    assert settings.database_url.endswith("test.db")
    assert settings.storage_driver == "local"


def test_settings_require_environment_specific_values(monkeypatch: pytest.MonkeyPatch) -> None:
    # conftest.py exports these three into the real process environment, and
    # `_env_file=None` only disables the dotenv *file* source, not the
    # environment source. Without clearing them Settings finds the conftest
    # values and never raises, so the assertion below would not test anything.
    for key in ("DATABASE_URL", "JWT_SECRET_KEY", "CORS_ORIGINS"):
        monkeypatch.delenv(key, raising=False)

    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_settings_reject_short_jwt_secret() -> None:
    with pytest.raises(ValueError, match="JWT_SECRET_KEY"):
        # The whole point of this assertion is that the value is invalid, so the
        # literal cannot be moved out of the call. S106 is suppressed rather than
        # satisfied because there is no compliant rewrite; the real secret scanner
        # for this repository is gitleaks, which still scans this file.
        validate_settings(local_settings(jwt_secret_key="too-short"))  # noqa: S106


def test_settings_require_s3_location_for_s3_driver() -> None:
    with pytest.raises(ValueError, match="AWS_REGION and S3_BUCKET"):
        validate_settings(local_settings(storage_driver="s3", aws_region=None, s3_bucket=None))


def test_settings_return_validated_s3_location() -> None:
    settings = validate_settings(
        local_settings(storage_driver="s3", aws_region="us-east-1", s3_bucket="test-private-bucket")
    )

    assert settings.require_s3_location() == ("us-east-1", "test-private-bucket")
