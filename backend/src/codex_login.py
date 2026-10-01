"""Sign in with ChatGPT (SIWC) once per machine so Serra can use your personal ChatGPT plan quota.

Run this locally before starting the API if OPENAI_API_KEY is not set:

    uv run python -m src.codex_login

Opens a browser for OAuth login and caches the token under backend/.codex_oauth_state (gitignored).
The running API server only reads and refreshes this cache — it never performs the interactive
login itself.
"""

from src.auth.codex_oauth import load_or_login


def main() -> None:
    load_or_login()
    print("Signed in. The backend will pick up the cached token automatically and refresh it as needed.")  # noqa: T201


if __name__ == "__main__":
    main()
