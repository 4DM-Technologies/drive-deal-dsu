"""Tests for the centralized logging configuration and the log settings that drive it."""

import logging

import pytest
import structlog

from src.settings import LOG_LEVELS, Settings, get_settings
from src.utils import logger as logger_module
from src.utils.logger import LOGGER_NAME, configure_logging, logger


def test_logger_is_bound_to_application_name() -> None:
    assert logger_module.LOGGER_NAME == "drivedeal"
    assert LOGGER_NAME == "drivedeal"
    assert logger is not None


def test_configure_logging_is_idempotent() -> None:
    before = logger_module._configured
    configure_logging()
    configure_logging()
    assert logger_module._configured is True
    logger_module._configured = before


def test_configure_logging_installs_json_renderer() -> None:
    configure_logging()
    processors = structlog.get_config()["processors"]
    # structlog instantiates processor classes while building the chain, so match on type.
    assert any(isinstance(processor, structlog.processors.JSONRenderer) for processor in processors)
    assert any(isinstance(processor, structlog.processors.TimeStamper) for processor in processors)
    assert structlog.contextvars.merge_contextvars in processors
    assert structlog.processors.add_log_level in processors


def test_resolve_level_reads_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(logger_module, "get_settings", lambda: Settings(log_level="WARNING"))
    assert logger_module._resolve_level() == logging.WARNING


def test_resolve_level_defaults_to_info_when_settings_fail(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom() -> None:
        raise ValueError("no settings")

    monkeypatch.setattr(logger_module, "get_settings", boom)
    assert logger_module._resolve_level() == logging.INFO


def test_resolve_level_falls_back_for_unknown_level(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(logger_module, "get_settings", lambda: Settings.model_construct(log_level="NOPE"))
    assert logger_module._resolve_level() == logging.INFO


def test_get_settings_is_cached() -> None:
    assert get_settings() is get_settings()


@pytest.mark.parametrize("level", LOG_LEVELS)
def test_log_level_validator_accepts_known_levels(level: str) -> None:
    assert Settings(log_level=level.lower()).log_level == level


def test_log_level_validator_rejects_unknown_level() -> None:
    with pytest.raises(ValueError, match="LOG_LEVEL must be one of"):
        Settings(log_level="verbose")


def test_log_flow_enabled_defaults_to_true() -> None:
    assert Settings().log_flow_enabled is True