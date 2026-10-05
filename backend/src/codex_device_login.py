"""Sign in with ChatGPT via the OAuth Device Authorization Grant — for machines with no browser
(SSH, Docker, CI, a remote server), or where the account approving sign-in is on someone else's
already-logged-in browser. Verified working end-to-end (see testing/codex-device-auth).

Run this once per machine instead of `src.codex_login` when opening a local browser isn't possible,
or when the account that needs to approve this sign-in belongs to someone else:

    uv run python -m src.codex_device_login

Prints a URL (https://auth.openai.com/codex/device) and a short code. Send both to whoever needs
to approve this — they open the link on *their* already-logged-in browser, sign in if prompted,
and enter the code. This process polls in the background and caches the resulting tokens under
the same S3 state `src.codex_login` uses, so the running API picks them up automatically with no
other change needed.

Requires "Device code" sign-in to be enabled for that ChatGPT account/workspace
(Settings -> Security) — if it isn't, this fails with a clear message telling you to use
`src.codex_login` (the browser flow) instead.
"""

from src.auth.codex_oauth import device_login


def main() -> None:
    device_login()
    print("Signed in. The backend will pick up the cached token automatically and refresh it as needed.")  # noqa: T201


if __name__ == "__main__":
    main()
