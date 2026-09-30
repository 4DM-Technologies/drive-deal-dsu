"""Sign in with ChatGPT (SIWC) OAuth + PKCE credential source for Serra's LLM calls.

Ported from the tem/siwc-official reference sandbox into the real backend. Interactive login
(opens a browser, spins up a local callback server) must be run once per machine via
`uv run python -m src.codex_login` — the API server itself never opens a browser. At request
time it only loads the cached token and refreshes it proactively when it is near expiry.

Docs: https://developers.openai.com/siwc
"""

import base64
import hashlib
import http.server
import json
import secrets
import time
import urllib.parse
import uuid
import webbrowser
from pathlib import Path
from typing import Any

import httpx

from src.settings import PROJECT_ROOT, get_settings

AUTH_URL = "https://auth.openai.com/api/accounts/authorize"
TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token"
BOOTSTRAP_CLIENT_ID = "dynamic_agent_client"
RESOURCE = "https://api.openai.com/v1"
REDIRECT_PORT = 1455
REDIRECT_URI = f"http://127.0.0.1:{REDIRECT_PORT}/auth/callback"
SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"

# How much lead time to refresh before the access token's JWT `exp` claim is actually reached.
_REFRESH_SKEW_SECONDS = 120

STATE_DIR = PROJECT_ROOT / ".codex_oauth_state"
HOST_ID_FILE = STATE_DIR / "host_id.txt"
CLIENT_ID_FILE = STATE_DIR / "client_id.txt"
TOKENS_FILE = STATE_DIR / "tokens.json"


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
    STATE_DIR.mkdir(exist_ok=True)
    if HOST_ID_FILE.exists():
        return HOST_ID_FILE.read_text().strip()
    host_id = "urn:uuid:" + str(uuid.uuid4())
    HOST_ID_FILE.write_text(host_id)
    return host_id


def _saved_client_id() -> str:
    configured = get_settings().codex_oauth_client_id
    if configured:
        return configured
    if CLIENT_ID_FILE.exists():
        return CLIENT_ID_FILE.read_text().strip()
    return BOOTSTRAP_CLIENT_ID


def _read_cache() -> dict:
    if not TOKENS_FILE.exists():
        return {}
    return json.loads(TOKENS_FILE.read_text())


def _remember_client_id(client_id: str) -> None:
    if client_id and client_id != BOOTSTRAP_CLIENT_ID:
        STATE_DIR.mkdir(exist_ok=True)
        CLIENT_ID_FILE.write_text(client_id)


def _save_tokens(tokens: dict) -> None:
    STATE_DIR.mkdir(exist_ok=True)
    TOKENS_FILE.write_text(json.dumps(tokens, indent=2))


def _token_near_expiry(tokens: dict) -> bool:
    exp = _jwt_claims(tokens.get("access_token", "")).get("exp")
    return bool(exp) and float(exp) <= time.time() + _REFRESH_SKEW_SECONDS


class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    result: dict[str, str] | None = None

    def do_GET(self) -> None:  # noqa: N802 — required by BaseHTTPRequestHandler
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/auth/callback":
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

    server = http.server.HTTPServer(("127.0.0.1", REDIRECT_PORT), _CallbackHandler)
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

    with httpx.Client(timeout=30) as http_client:
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
    async with httpx.AsyncClient(timeout=30) as http_client:
        resp = await http_client.post(
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
    # Some refresh responses omit refresh_token, meaning the old one is still valid — keep it.
    refreshed.setdefault("refresh_token", tokens["refresh_token"])
    to_save = refreshed if persist_refresh_token else {k: v for k, v in refreshed.items() if k != "refresh_token"}
    _save_tokens(to_save)
    return refreshed


async def get_cached_access_token() -> str | None:
    """Non-interactive credential source for the running API server.

    Prefers the durable secret in `CODEX_OAUTH_REFRESH_TOKEN` (env) if set — this is the source of
    truth on a shared/deployed machine. Falls back to the file cache written by `src.codex_login`
    (local interactive sign-in) otherwise. Either way, the short-lived access token is cached to
    `tokens.json` and only refreshed over the network when it is near expiry — never every call.
    Returns None (never opens a browser or blocks) if no credential is configured, so callers can
    fall back to another credential or the deterministic Serra fallback.
    """
    configured_refresh_token = get_settings().codex_oauth_refresh_token
    if configured_refresh_token:
        # The refresh token itself is never written to disk here — CODEX_OAUTH_REFRESH_TOKEN (env)
        # is the durable secret; only the short-lived access token it mints gets cached, to avoid
        # keeping two copies of the same long-lived secret at rest.
        cached = _read_cache()
        if cached.get("access_token") and not _token_near_expiry(cached):
            return cached["access_token"]
        try:
            tokens = await _refresh_async({"refresh_token": configured_refresh_token}, persist_refresh_token=False)
        except RuntimeError:
            return None
        return tokens.get("access_token")

    if not TOKENS_FILE.exists():
        return None
    tokens = _read_cache()
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
    if not TOKENS_FILE.exists():
        return login()
    tokens = json.loads(TOKENS_FILE.read_text())
    if _token_near_expiry(tokens):
        if not tokens.get("refresh_token"):
            return login()
        try:
            with httpx.Client(timeout=30) as http_client:
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
