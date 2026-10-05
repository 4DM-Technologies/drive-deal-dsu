"""Standalone, diagnostic test: can we actually get an LLM reply through the ChatGPT/Codex backend
at CODEX_API_BASE_URL?

This is deliberately NOT wired into the real backend (backend/src/agents/llm.py) — it's a throwaway
script to find out what that base URL actually accepts/returns before touching production code.

What it does:
  1. Reuses backend/src/auth/codex_oauth.py's own get_cached_access_token() to get a valid access
     token. This is NOT reimplemented here: a naive standalone refresh using the static
     CODEX_OAUTH_REFRESH_TOKEN from .env fails with "invalid_grant" — this provider rotates the
     refresh token on every use and the backend caches the rotated one in S3 (see
     get_cached_access_token()'s docstring), so only the real backend module has the current one.
  2. Sends one "hi" prompt to CODEX_API_BASE_URL + "/responses" (hardcoded, as given) with that
     access token, and prints the raw HTTP status + body so we can see exactly what this base URL
     does with it - this part genuinely hasn't been verified yet.

Usage:
    cd backend && .venv/Scripts/python.exe ../testing/codex-llm-test/test_codex_llm.py
"""

import asyncio
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

BACKEND_SRC = Path(__file__).resolve().parents[2] / "backend"
if str(BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(BACKEND_SRC))

from src.auth.codex_oauth import get_cached_access_token  # noqa: E402

# New/unverified piece - given directly for this test, not yet confirmed to work.
CODEX_API_BASE_URL = "https://chatgpt.com/backend-api/codex"


def _post(url: str, *, json_body: dict, bearer: str) -> tuple[int, str]:
    headers = {
        "User-Agent": "codex_cli_rs",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {bearer}",
    }
    data = json.dumps(json_body).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


def main() -> None:
    print("Fetching the backend's current cached access token...")  # noqa: T201
    access_token = asyncio.run(get_cached_access_token())
    if not access_token:
        raise SystemExit(
            "No cached access token available (checked OPENAI_API_KEY, CODEX_OAUTH_ACCESS_TOKEN env, "
            "CODEX_OAUTH_REFRESH_TOKEN env, and the S3-cached state). Run `uv run python -m src.codex_login` "
            "from backend/ first, or confirm AWS/S3 settings are configured."
        )
    print("Got access token. Calling the Codex backend...\n")  # noqa: T201

    status, body = _post(
        f"{CODEX_API_BASE_URL}/responses",
        json_body={
            "model": "gpt-5.6-luna",
            "input": [{"role": "user", "content": "hi"}],
            "store": False,
            "stream": False,
        },
        bearer=access_token,
    )

    print(f"HTTP {status}")  # noqa: T201
    print(body[:4000])  # noqa: T201


if __name__ == "__main__":
    main()
