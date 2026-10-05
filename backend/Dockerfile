# syntax=docker/dockerfile:1

ARG PYTHON_VERSION=3.11
ARG UV_VERSION=0.12.18

# ===========================================================================
# Builder: resolve the locked dependency set with uv and materialise the
# virtual environment at /opt/venv. pip is not used anywhere in this image.
# ===========================================================================
FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

FROM python:${PYTHON_VERSION}-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0 \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /build

COPY --from=uv /uv /uvx /usr/local/bin/
COPY pyproject.toml uv.lock ./

# --frozen installs exactly what uv.lock pins, so a stale lock fails the build
# instead of silently resolving new versions. --no-dev keeps test/lint tooling
# out of the runtime image, --no-install-project skips building this package
# (the app is run from /app, not imported as a distribution).
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# ===========================================================================
# Runtime
# ===========================================================================
FROM python:${PYTHON_VERSION}-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv

RUN useradd --create-home --shell /bin/bash appuser

COPY --chown=appuser:appuser . /app

RUN mkdir -p /app/data /app/uploads \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')"]

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
