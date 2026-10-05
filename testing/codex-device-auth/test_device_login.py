"""Standalone test of the OpenAI/ChatGPT OAuth Device Authorization Grant (RFC 8628) — the flow
behind https://auth.openai.com/codex/device.

This is deliberately NOT wired into the real backend (backend/src/auth/codex_oauth.py) yet. It is
a throwaway script to prove the flow actually works end-to-end — request a code, show it to a
human, poll until approved, exchange it for tokens — before any of this touches production auth
code. Tokens are printed and saved to ./device_tokens.json in this folder only; nothing is written
to the backend's S3-backed OAuth state.

No third-party dependencies — stdlib only (urllib), so it runs with any Python 3.9+.

Usage:
    python test_device_login.py
    python test_device_login.py --client-id app_EMoamEEZ73f0CkXaXp7hrann

Every endpoint/field name below was verified against OpenAI's own open-source Codex CLI
(github.com/openai/codex, codex-rs/login/src/device_code_auth.rs and
codex-rs/login/src/oauth/client.rs) — OpenAI has not published a device-flow API reference, so
this is reverse-engineered from that source, not from official docs.

IMPORTANT: this will fail with a clear "not enabled" error unless "Device code" sign-in is turned
on for your ChatGPT account/workspace (Settings -> Security). That's an OpenAI-side account
setting this script cannot change.
"""

import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Confirmed from codex-rs/login/src/device_code_auth.rs: POST {issuer}/api/accounts/deviceauth/usercode
# and {issuer}/api/accounts/deviceauth/token.
USERCODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode"
TOKEN_POLL_URL = "https://auth.openai.com/api/accounts/deviceauth/token"
# Confirmed from codex-rs/login/src/server.rs: the final code->token exchange goes to "{issuer}/oauth/token".
EXCHANGE_URL = "https://auth.openai.com/oauth/token"
# Where a human enters the user_code shown to them - the URL given for this feature.
VERIFICATION_URL = "https://auth.openai.com/codex/device"
# The device flow has no browser callback, so it uses this fixed redirect_uri instead of a
# localhost one (confirmed in device_code_auth.rs: `format!("{base_url}/deviceauth/callback")`).
DEVICE_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback"
# Codex CLI's own public OAuth client id (same one it uses for the browser PKCE flow too).
DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
POLL_TIMEOUT_SECONDS = 15 * 60
DEFAULT_POLL_INTERVAL_SECONDS = 5
OUTPUT_FILE = Path(__file__).parent / "device_tokens.json"
# Verified live: Cloudflare returns 530 cf_route_error for urllib's default "Python-urllib/x.y"
# User-Agent on these endpoints. Any real-looking value works - this just avoids looking like a bot.
USER_AGENT = "codex_cli_rs"


def _post_json(url: str, payload: dict) -> tuple[int, dict | None, str]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url, data=body, method="POST", headers={"Content-Type": "application/json", "User-Agent": USER_AGENT}
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else None, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(raw), raw
        except json.JSONDecodeError:
            return exc.code, None, raw


def _post_form(url: str, fields: dict) -> tuple[int, dict | None, str]:
    body = urllib.parse.urlencode(fields)
    request = urllib.request.Request(
        url,
        data=body.encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else None, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(raw), raw
        except json.JSONDecodeError:
            return exc.code, None, raw


def request_user_code(client_id: str) -> dict:
    status, data, raw = _post_json(USERCODE_URL, {"client_id": client_id})
    if status == 404:
        raise RuntimeError(
            "404: device code login is not enabled for this ChatGPT account/workspace.\n"
            "Turn it on in ChatGPT Settings -> Security -> Device code sign-in, then re-run this script."
        )
    if status >= 400:
        raise RuntimeError(f"Device code request failed ({status}): {raw}")
    user_code = data.get("user_code") or data.get("usercode")
    if not data.get("device_auth_id") or not user_code:
        raise RuntimeError(f"Unexpected response (missing device_auth_id/user_code): {data}")
    try:
        interval = int(str(data.get("interval", DEFAULT_POLL_INTERVAL_SECONDS)).strip())
    except ValueError:
        interval = DEFAULT_POLL_INTERVAL_SECONDS
    return {"device_auth_id": data["device_auth_id"], "user_code": user_code, "interval": interval}


def poll_for_code(device_auth_id: str, user_code: str, interval: int) -> dict:
    """403/404 both mean "still pending" (matches the Codex CLI's own polling logic)."""
    deadline = time.time() + POLL_TIMEOUT_SECONDS
    attempt = 0
    while True:
        attempt += 1
        status, data, raw = _post_json(TOKEN_POLL_URL, {"device_auth_id": device_auth_id, "user_code": user_code})
        if status == 200:
            for field in ("authorization_code", "code_challenge", "code_verifier"):
                if field not in data:
                    raise RuntimeError(f"Token-poll response missing '{field}': {data}")
            return data
        if status in (403, 404):
            remaining = deadline - time.time()
            if remaining <= 0:
                raise RuntimeError("Timed out after 15 minutes - no approval was received.")
            print(f"  still waiting for approval... (attempt {attempt}, {int(remaining)}s left)")  # noqa: T201
            time.sleep(min(interval, remaining))
            continue
        raise RuntimeError(f"Device sign-in failed ({status}): {raw}")


def exchange_for_tokens(client_id: str, code: str, code_verifier: str) -> dict:
    status, data, raw = _post_form(
        EXCHANGE_URL,
        {
            "grant_type": "authorization_code",
            "client_id": client_id,
            "code": code,
            "redirect_uri": DEVICE_REDIRECT_URI,
            "code_verifier": code_verifier,
        },
    )
    if status >= 400:
        raise RuntimeError(f"Token exchange failed ({status}): {raw}")
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description="Test the OpenAI device-code OAuth flow end to end.")
    parser.add_argument("--client-id", default=DEFAULT_CLIENT_ID, help="OAuth client_id to use")
    args = parser.parse_args()

    print(f"Requesting a device code (client_id={args.client_id})...")  # noqa: T201
    device_code = request_user_code(args.client_id)

    print("\nContinue only if you started this sign-in yourself.")  # noqa: T201
    print("If a website or another person gave you this code, cancel.\n")  # noqa: T201
    print(f"1. Visit: {VERIFICATION_URL}")  # noqa: T201
    print(f"2. Enter code: {device_code['user_code']}\n")  # noqa: T201

    code_result = poll_for_code(device_code["device_auth_id"], device_code["user_code"], device_code["interval"])
    print("Approved! Exchanging the code for tokens...")  # noqa: T201

    tokens = exchange_for_tokens(args.client_id, code_result["authorization_code"], code_result["code_verifier"])
    OUTPUT_FILE.write_text(json.dumps(tokens, indent=2), encoding="utf-8")

    print(f"\nSuccess. Tokens saved to {OUTPUT_FILE}")  # noqa: T201
    print(f"access_token present: {bool(tokens.get('access_token'))}")  # noqa: T201
    print(f"refresh_token present: {bool(tokens.get('refresh_token'))}")  # noqa: T201
    print(f"scope: {tokens.get('scope', '(not returned)')}")  # noqa: T201


if __name__ == "__main__":
    main()
