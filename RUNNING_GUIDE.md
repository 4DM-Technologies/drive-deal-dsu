# Deal&Drive running guide

The backend is managed with [uv](https://docs.astral.sh/uv/). `backend/uv.lock` is committed, so
`uv sync` reproduces the exact resolved dependency set and installs the `drivedeal-api` project
itself as an editable install. Do not create or activate a virtual environment by hand — uv owns
`backend/.venv`.

## 1. Backend

From PowerShell:

```powershell
cd "C:\Users\Syed Thameemuddin\Desktop\Cube Simple\drive-deal-dsu\backend"
uv sync
# For getting the one-time token with opening the browser
uv run python -m src.codex_login
# Run the backend app
uv run uvicorn main:app --reload
```

Open the API docs at `http://127.0.0.1:8000/api/v1/docs`.

### What each step does

| Command | Purpose |
|---|---|
| `uv sync` | Creates/reuses `backend/.venv` and installs the project plus the `dev` dependency group (pytest, pytest-asyncio, pytest-cov, ruff, bandit). |
| `uv run uvicorn main:app --reload` | Starts uvicorn on `127.0.0.1:8000` from `backend/main.py`, the only application entry point. |

The database must already exist and hold its schema — the server calls `create_schema()` on startup,
but it never creates a database and never seeds data. The provisioned RDS instance is already set up.
To install the demo dataset into an empty local database, run `uv run python -m tests.demo_data`
(idempotent — it only fills rows that are missing).

### Serra AI layer: live versus demo mode

`AI_DISABLED` is **opt-in**. By default the Serra LangGraph workflow executes; set `AI_DISABLED=true`
in `backend/.env` only when you want a credential-free product demo.

| | Normal flow | `AI_DISABLED=true` |
|---|---|---|
| LangGraph graphs | Built and executed | Skipped entirely |
| Serra answer | Model output, or the deterministic fallback | Canned scripted answer |
| Where | `src/agents/serra/graph.py` | `src/services/ai_service.py:23-26` → `_stream_demo()` |

### LLM credentials

Credentials are read from `backend/.env`, in this order:

1. `OPENAI_API_KEY` — a normal metered API key.
2. `CODEX_OAUTH_ACCESS_TOKEN` — a fixed "Sign in with ChatGPT" (SIWC) access token pasted directly.
   Short-lived (~1 hour) and does **not** auto-refresh; only useful for a quick manual test.
3. `CODEX_OAUTH_CLIENT_ID` + `CODEX_OAUTH_REFRESH_TOKEN` — **self-refreshing**, recommended if you're
   the only one signing in with a personal ChatGPT account. The backend mints a fresh short-lived
   access token from the refresh token automatically whenever the cached one is near expiry — no
   manual re-pasting.
4. A cached local login from `uv run python -m src.codex_login` (see below) — same self-refresh
   behavior as (3), but the refresh token lives in a local file instead of `.env`.

```env
OPENAI_API_KEY=
CODEX_OAUTH_ACCESS_TOKEN=
CODEX_OAUTH_CLIENT_ID=
CODEX_OAUTH_REFRESH_TOKEN=
OPENAI_MODEL=gpt-5.6-sol
OPENAI_REASONING_EFFORT=medium
```

`CODEX_OAUTH_REFRESH_TOKEN` is a **long-lived secret** — equivalent to a password for that ChatGPT
account, since it can mint new access tokens indefinitely until revoked. Treat it like
`JWT_SECRET_KEY`/`AWS_SECRET_ACCESS_KEY`: never commit it, never log it, and if it's ever exposed,
revoke the session from your OpenAI account and sign in again. `backend/.env` is gitignored, but
putting all secrets in one file means a leaked `.env` exposes all of them together — know that
tradeoff before choosing this over option (4).

If you'd rather sign in interactively instead of setting env vars, run this once per machine (opens
a browser):

```powershell
cd backend
uv run python -m src.codex_login
```

This caches the token under `backend/.codex_oauth_state/` (gitignored). The running API server never
opens a browser itself — it only reads and proactively refreshes the applicable cached/configured
token (`src/auth/codex_oauth.py`). Either way this credential is bound to the individual who signed
in and is meant for local/dev use, not as a shared production credential for all buyers/dealers.

If none of the above is available, `src/agents/llm.py` leaves the client as `None` and every request
uses the deterministic fallback text. The API stays fully functional, so a missing credential
degrades rather than errors.

Web search is off by default. Enable it with `AI_ENABLE_WEB_SEARCH=true` (requires
`uv sync --extra web` for Crawl4AI).

### Hot reload caveat

`--reload` is passed straight to uvicorn and WatchFiles does start and detect file changes
(`WatchFiles detected changes in 'src\...'`). On Windows the reloader was observed logging
`Reloading...` without completing the process restart, so the old code can keep serving. If your
edit does not take effect, stop the command with `Ctrl+C` and start it again.

## 2. Frontend

In a second PowerShell window:

```powershell
cd "C:\Users\Syed Thameemuddin\Desktop\Cube Simple\drive-deal-dsu\frontend"
npm install
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`.

`package.json` lives in `frontend/`, not the repository root, so `npm run dev` from the root fails
with `ENOENT ... package.json`. Either `cd` into `frontend/` or use `npm run dev --prefix frontend`.

The current `frontend/.env` uses `VITE_USE_MOCKS=true`, which is ideal for a self-contained lead
demo. To use the running API, change it to `false` and restart Vite.

## 3. Demo login accounts

Every account uses password `demo1234`.

| Workspace | Email | Home after login |
|---|---|---|
| Buyer | `rahul@drivedeal.demo` | `/home` |
| Buyer | `adithyaa@drivedeal.demo` | `/home` |
| Dealer | `naveen@naveemotors.demo` | `/home` |
| Support | `maya@drivedeal.demo` | `/support` |
| Support administrator | `priya@drivedeal.demo` | `/support` |
| Admin | `alex@drivedeal.demo` | `/support` |

On the login page, pick Buyer or Dealer. Team sign-in accepts both support and support-admin accounts and is intentionally kept on the restricted team route. The Deal&Drive wordmark always returns an authenticated user to their role home. Only support-admin and admin sessions see the Administrator navigation item; changing a support member's role invalidates their existing session and requires a new sign-in.

## 4. Verification

```powershell
cd "C:\Users\Syed Thameemuddin\Desktop\Cube Simple\drive-deal-dsu\frontend"
npm run lint
npm test
npm run build

cd "C:\Users\Syed Thameemuddin\Desktop\Cube Simple\drive-deal-dsu\backend"
uv run ruff check .
uv run pytest -q
uv run bandit -q -r src
```

Current status of these gates:

- `uv run ruff check .` — passes.
- `uv run pytest -q` — passes (17 tests), coverage 75.12%, above the 75% floor in `pyproject.toml`.
- `uv run bandit -q -r src` — passes, no findings.
- `uv run ruff format --check src` — **fails** on 28 pre-existing files. CI Stage 3 runs this too, so
  formatting is already out of date independently of the uv migration. Run
  `uv run ruff format src` as its own change rather than folding it into unrelated work.

## 5. Containers and CI

Docker and GitHub Actions still install from `backend/requirements.txt` via pip; they were not
converted to uv. `uv.lock` governs local development. Keep `requirements.txt` in step with
`pyproject.toml` when adding dependencies, or the container image will drift from local runs.
