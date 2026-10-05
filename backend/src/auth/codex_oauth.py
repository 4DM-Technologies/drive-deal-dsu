"""Sign in with ChatGPT (SIWC) OAuth + PKCE credential source for Serra's LLM calls.

Ported from the tem/siwc-official reference sandbox into the real backend. Interactive login
(opens a browser, spins up a local callback server) must be run once per machine via
`uv run python -m src.codex_login` — the API server itself never opens a browser. At request
time it only loads the cached token and refreshes it proactively when it is near expiry.

Docs: https://developers.openai.com/siwc
"""

import asyncio
import base64
import hashlib
import http.server
import json
import secrets
import time
import urllib.parse
import uuid
import webbrowser
from typing import Any

import httpx

from src.auth.codex_oauth_store import CodexOAuthS3Store
from src.settings import (
    CODEX_OAUTH_AUTHORIZE_URL as AUTH_URL,
)
from src.settings import (
    CODEX_OAUTH_BOOTSTRAP_CLIENT_ID as BOOTSTRAP_CLIENT_ID,
)
from src.settings import (
    CODEX_OAUTH_CALLBACK_PATH,
    CODEX_OAUTH_HTTP_TIMEOUT_SECONDS,
    CODEX_OAUTH_REDIRECT_HOST,
    CODEX_OAUTH_REFRESH_SKEW_SECONDS,
    get_settings,
)
from src.settings import (
    CODEX_OAUTH_CLIENT_ID_FILE as CLIENT_ID_NAME,
)
from src.settings import (
    CODEX_OAUTH_HOST_ID_FILE as HOST_ID_NAME,
)
from src.settings import (
    CODEX_OAUTH_LEGACY_STATE_DIR as LEGACY_STATE_DIR,
)
from src.settings import (
    CODEX_OAUTH_REDIRECT_PORT as REDIRECT_PORT,
)
from src.settings import (
    CODEX_OAUTH_REDIRECT_URI as REDIRECT_URI,
)
from src.settings import (
    CODEX_OAUTH_RESOURCE as RESOURCE,
)
from src.settings import (
    CODEX_OAUTH_SCOPES as SCOPES,
)
from src.settings import (
    CODEX_OAUTH_TOKEN_URL as TOKEN_URL,
)
from src.settings import (
    CODEX_OAUTH_TOKENS_FILE as TOKENS_NAME,
)
from src.utils.logger import logger


def _state_store() -> CodexOAuthS3Store:
    return CodexOAuthS3Store.from_settings()


def _read_state(name: str) -> str | None:
    """Read S3 first and migrate an old local file only after its upload succeeds."""
    store = _state_store()
    value = store.read_text(name)
    legacy_file = LEGACY_STATE_DIR / name
    if value is not None:
        if legacy_file.exists():
            legacy_file.unlink()
            try:
                LEGACY_STATE_DIR.rmdir()
            except OSError:
                pass
        return value
    if not legacy_file.exists():
        return None
    value = legacy_file.read_text(encoding="utf-8")
    store.write_text(name, value, "application/json" if name.endswith(".json") else "text/plain")
    legacy_file.unlink()
    try:
        LEGACY_STATE_DIR.rmdir()
    except OSError:
        pass
    return value


def _write_state(name: str, value: str) -> None:
    _state_store().write_text(name, value, "application/json" if name.endswith(".json") else "text/plain")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _pkce_pair() -> tuple[str, str]:
    verifier = _b64url(secrets.token_bytes(32))
    challenge = _b64url(hashlib.sha256(verifier.encode()).digest())
    return verifier, challenge


def _jwt_claims(token: str) -> dict[str, Any]:
    """Decodes a JWT's payload without verifying its signature — fine here since we only ever
    read a claim (`exp`) from a token OpenAI itself just issued to us; we never trust a token
    from elsewhere."""
    try:
        part = token.split(".")[1]
        decoded = base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
        return json.loads(decoded)
    except Exception:
        return {}


def _host_id() -> str:
    saved = _read_state(HOST_ID_NAME)
    if saved:
        return saved.strip()
    host_id = "urn:uuid:" + str(uuid.uuid4())
    _write_state(HOST_ID_NAME, host_id)
    return host_id


def _saved_client_id() -> str:
    configured = get_settings().codex_oauth_client_id
    if configured:
        return configured
    saved = _read_state(CLIENT_ID_NAME)
    if saved:
        return saved.strip()
    return BOOTSTRAP_CLIENT_ID


def _read_cache() -> dict:
    # The cached ChatGPT OAuth token is an optional optimisation, not a
    # dependency: LlmClient._resolve_client() treats "no cached token" as
    # "fall back to OPENAI_API_KEY, then to the deterministic stub". So a failure
    # to read the cache must degrade to an empty result. Raising instead turns
    # every /api/v1/ai/* request into a 500 whenever the token store is
    # unreachable -- which is the normal state for a deployment running
    # STORAGE_DRIVER=local with no AWS_REGION/S3_BUCKET configured, because
    # _read_state() resolves the S3 store unconditionally.
    try:
        raw = _read_state(TOKENS_NAME)
    except Exception as exc:
        logger.warning("codex_oauth_token_cache_unavailable", error=str(exc)[:200])
        return {}
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Codex OAuth token state in S3 is not valid JSON.") from exc


def _remember_client_id(client_id: str) -> None:
    if client_id and client_id != BOOTSTRAP_CLIENT_ID:
        _write_state(CLIENT_ID_NAME, client_id)


def _save_tokens(tokens: dict) -> None:
    _write_state(TOKENS_NAME, json.dumps(tokens, indent=2))


def _token_near_expiry(tokens: dict) -> bool:
    exp = _jwt_claims(tokens.get("access_token", "")).get("exp")
    return bool(exp) and float(exp) <= time.time() + CODEX_OAUTH_REFRESH_SKEW_SECONDS


class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    result: dict[str, str] | None = None

    def do_GET(self) -> None:  # noqa: N802 — required by BaseHTTPRequestHandler
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != CODEX_OAUTH_CALLBACK_PATH:
            self.send_response(404)
            self.end_headers()
            return
        params = urllib.parse.parse_qs(parsed.query)
        _CallbackHandler.result = {k: v[0] for k, v in params.items()}
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<html><body><h3>Signed in. You can close this tab.</h3></body></html>")

    def log_message(self, *_args: object) -> None:  # silence default request logging
        pass


def login() -> dict:
    """Runs the interactive browser OAuth flow and caches the resulting tokens.

    For local/dev use only (via `src.codex_login`) — never called from the running API server.
    """
    host_id = _host_id()
    client_id = _saved_client_id()

    verifier, challenge = _pkce_pair()
    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "resource": RESOURCE,
        "state": state,
        "nonce": nonce,
        "code_challenge_method": "S256",
        "code_challenge": challenge,
        "ext_agent_host_id": host_id,
        "agent_name_hint": "drivedeal-backend",
    }
    url = AUTH_URL + "?" + urllib.parse.urlencode(params)
    print("Opening your browser to sign in with ChatGPT...")  # noqa: T201
    print(f"If it doesn't open automatically, visit:\n{url}\n")  # noqa: T201
    webbrowser.open(url)

    server = http.server.HTTPServer((CODEX_OAUTH_REDIRECT_HOST, REDIRECT_PORT), _CallbackHandler)
    print("Waiting for the browser callback...")  # noqa: T201
    while _CallbackHandler.result is None:
        server.handle_request()
    result = _CallbackHandler.result

    if result.get("state") != state:
        raise RuntimeError("OAuth state mismatch — possible tampering, aborting.")
    if "error" in result:
        raise RuntimeError(f"OAuth error: {result['error']}: {result.get('error_description', '')}")

    # invalid_client on token exchange usually means the token endpoint wants the REAL client_id the
    # server registered during /authorize, not the "dynamic_agent_client" placeholder — that real id is
    # commonly returned in the callback query string alongside `code`. Prefer it if present.
    token_client_id = result.get("client_id") or client_id

    with httpx.Client(timeout=CODEX_OAUTH_HTTP_TIMEOUT_SECONDS) as http_client:
        resp = http_client.post(
            TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "client_id": token_client_id,
                "code": result["code"],
                "code_verifier": verifier,
                "redirect_uri": REDIRECT_URI,
                "resource": RESOURCE,
            },
        )
    if resp.status_code >= 400:
        safe_result = {k: ("<redacted>" if k == "code" else v) for k, v in result.items()}
        raise RuntimeError(
            f"Token exchange failed ({resp.status_code}): {resp.text}\n"
            f"client_id used: {token_client_id}\n"
            f"Callback params received: {safe_result}"
        )
    tokens = resp.json()
    if "chatgpt.tokens.use.direct" not in tokens.get("scope", ""):
        print(  # noqa: T201
            "Warning: the granted scope did not include chatgpt.tokens.use.direct — plan usage may not work."
        )
    issued_client_id = tokens.get("client_id") or result.get("client_id") or resp.headers.get("X-Client-Id")
    if issued_client_id:
        _remember_client_id(issued_client_id)
    _save_tokens(tokens)
    return tokens


async def _refresh_async(tokens: dict, *, persist_refresh_token: bool = True) -> dict:
    client_id = await asyncio.to_thread(_saved_client_id)
    async with httpx.AsyncClient(timeout=CODEX_OAUTH_HTTP_TIMEOUT_SECONDS) as http_client:
        resp = await http_client.post(
            TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": tokens["refresh_token"],
                "client_id": client_id,
            },
        )
    if resp.status_code >= 400:
        raise RuntimeError(f"Refresh failed ({resp.status_code}): {resp.text}")
    refreshed = resp.json()
    # Some refresh responses omit refresh_token, meaning the old one is still valid — keep it.
    refreshed.setdefault("refresh_token", tokens["refresh_token"])
    to_save = refreshed if persist_refresh_token else {k: v for k, v in refreshed.items() if k != "refresh_token"}
    await asyncio.to_thread(_save_tokens, to_save)
    return refreshed


async def get_cached_access_token() -> str | None:
    """Non-interactive credential source for the running API server.

    Prefers the durable secret in `CODEX_OAUTH_REFRESH_TOKEN` (env) if set — this is the source of
    truth on a shared/deployed machine. Falls back to the private S3 state written by `src.codex_login`
    (interactive sign-in) otherwise. Either way, the short-lived access token is cached under the
    configured S3 prefix and only refreshed over the network when it is near expiry — never every call.
    Returns None (never opens a browser or blocks) if no credential is configured, so callers can
    fall back to another credential or the deterministic Serra fallback.
    """
    configured_refresh_token = get_settings().codex_oauth_refresh_token
    if configured_refresh_token:
        # CODEX_OAUTH_REFRESH_TOKEN (env) is the bootstrap secret, but this provider rotates the
        # refresh token on every use — the server invalidates the old one and issues a new one in
        # the same response. So the rotated token must be cached and preferred on the next refresh,
        # or every refresh after the first fails with invalid_grant. The env var only matters again
        # if the cache is ever lost (e.g. redeployed) or its cached refresh token itself goes stale.
        cached = await asyncio.to_thread(_read_cache)
        if cached.get("access_token") and not _token_near_expiry(cached):
            return cached["access_token"]
        refresh_token = cached.get("refresh_token") or configured_refresh_token
        try:
            tokens = await _refresh_async({"refresh_token": refresh_token})
        except RuntimeError:
            if refresh_token == configured_refresh_token:
                return None
            try:
                tokens = await _refresh_async({"refresh_token": configured_refresh_token})
            except RuntimeError:
                return None
        return tokens.get("access_token")

    tokens = await asyncio.to_thread(_read_cache)
    if not tokens:
        return None
    if _token_near_expiry(tokens):
        if not tokens.get("refresh_token"):
            return None
        try:
            tokens = await _refresh_async(tokens)
        except RuntimeError:
            return None
    return tokens.get("access_token")


def load_or_login() -> dict:
    """Reuses a cached token if present (refreshing it if expired/near-expiry); otherwise logs in
    interactively. For local/dev use only (via `src.codex_login`)."""
    tokens = _read_cache()
    if not tokens:
        return login()
    if _token_near_expiry(tokens):
        if not tokens.get("refresh_token"):
            return login()
        try:
            with httpx.Client(timeout=CODEX_OAUTH_HTTP_TIMEOUT_SECONDS) as http_client:
                resp = http_client.post(
                    TOKEN_URL,
                    data={
                        "grant_type": "refresh_token",
                        "refresh_token": tokens["refresh_token"],
                        "client_id": _saved_client_id(),
                    },
                )
            if resp.status_code >= 400:
                raise RuntimeError(f"Refresh failed ({resp.status_code}): {resp.text}")
            refreshed = resp.json()
            refreshed.setdefault("refresh_token", tokens["refresh_token"])
            _save_tokens(refreshed)
            return refreshed
        except RuntimeError as exc:
            print(f"{exc}\nRefresh failed; signing in again.")  # noqa: T201
            return login()
    return tokens
