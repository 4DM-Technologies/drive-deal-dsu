"""Centralized structured logging configuration.

The agent tracing in ``src/agents/observability.py`` depends on the processor chain below, so the
chain is intentionally left exactly as it was: JSON lines on stdout with context variables merged,
ISO timestamp, level, stack info and formatted exceptions. Only the level became configurable.
"""

import logging
import sys

import structlog

from src.settings import get_settings

LOGGER_NAME = "drivedeal"

_configured = False


def _resolve_level() -> int:
    """Reads LOG_LEVEL from settings, defaulting to INFO when settings cannot be loaded."""
    try:
        level_name = get_settings().log_level
    except Exception:
        level_name = "INFO"
    return getattr(logging, str(level_name).upper(), logging.INFO)


def configure_logging() -> None:
    """Installs the JSON structlog chain and the stdlib bridge exactly once per process."""
    global _configured
    if _configured:
        return
    _configured = True
    level = _resolve_level()
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


logger = structlog.get_logger(LOGGER_NAME)