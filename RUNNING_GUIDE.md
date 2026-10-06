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

A fresh empty database needs no migration: `create_schema()` creates the complete schema on first
boot. A database created **before** the subscription feature is missing the billing columns and the
`payments` table; `create_schema()` never alters existing tables, so apply them with:

```powershell
uv run alembic stamp 20261004_0006
uv run alembic upgrade head
```

(The schema was historically created by `create_schema()` rather than Alembic, hence the stamp; the
billing revision `20261006_0007` is existence-guarded, so the upgrade is safe on any schema state.)

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

| Workspace | Email | Home after login | Plan |
|---|---|---|---|
| Buyer | `rahul@drivedeal.demo` | `/home` | Premium (1 year) |
| Buyer | `adithyaa@drivedeal.demo` | `/home` | Premium (1 year) |
| Buyer | `buyer3@drivedeal.demo` … `buyer10@drivedeal.demo` | `/home` | Free, 3/3 posts used — buyer paywall demo |
| Dealer | `naveen@naveemotors.demo` | `/home` | Premium (1 year) |
| Dealer | `elena@lonestar.demo` | `/home` | Premium (1 year) |
| Dealer | `dealer4@`, `dealer5@`, `dealer6@`, `dealer7@`, `dealer9@`, `dealer10@drivedeal.demo` | `/home` | Trial — 3 quotes left |
| Dealer | `dealer8@drivedeal.demo` | `/home` | Trial expired — dealer paywall demo |
| Dealer | `jordan@northtexas.demo` | `/home` | Suspended on the live RDS (support moderation demo) |
| Support | `maya@drivedeal.demo` | `/support` | n/a — staff have no subscription state |
| Support administrator | `priya@drivedeal.demo` | `/support` | n/a — staff |
| Admin | `alex@drivedeal.demo` | `/support` | n/a — staff |

Premium (rahul, adithyaa, naveen, elena), the expired `dealer8` trial and the buyers sitting at
3/3 posts are applied idempotently by `tests/demo_data.py` on both seed paths, so a fresh local
database matches the live RDS demo state — on RDS the premium plans run to **2027-10-06** and the
trial dealers' 60-day clock was pre-stamped to **2026-12-05**; locally premium is granted 365 days
from the seeding run and a dealer trial otherwise starts at that dealer's first login. `jordan` is
suspended on RDS; a fresh local seed starts him active until he is suspended from the support
workspace.

On the login page, pick Buyer or Dealer. Team sign-in accepts both support and support-admin accounts and is intentionally kept on the restricted team route. The Deal&Drive wordmark always returns an authenticated user to their role home. Only support-admin and admin sessions see the Administrator navigation item; changing a support member's role invalidates their existing session and requires a new sign-in.

## 4. Premium subscriptions & billing

Subscription state is derived on every read — profiles store only timestamps
(`trial_started_at`, `trial_expires_at`, `is_premium`, `premium_expires_at`), and every successful
payment is appended to the `payments` ledger. Card numbers and CVVs are never persisted: only the
detected brand and the last four digits.

| Plan | Price | Grants |
|---|---|---|
| Buyer premium | $100 / year | Unlimited car-buy posts |
| Buyer free | — | 3 car-buy posts for life, then the paywall |
| Dealer premium | $500 / year | Unlimited quotes |
| Dealer trial | Free, 60 days from first login | 3 quotes total |
| Dealer free | — | 0 quotes (trial expired or never started) |

Effective order: active premium → active dealer trial → free tier. Existing quotes, deals and
requests stay visible after expiry — only creating new ones is blocked, and Serra chat itself is
never blocked.

### Reading the state

`GET /api/v1/profiles/me` and `GET /api/v1/auth/me` include a `subscription` object for buyers and
dealers; staff sessions (support, support-admin, admin) are excluded:

```json
{
  "subscription": {
    "role": "dealer",
    "plan": "trial",
    "is_premium": false,
    "premium_expires_at": null,
    "trial_started_at": "2026-10-06T13:02:42+00:00",
    "trial_expires_at": "2026-12-05T13:02:42+00:00",
    "premium_price": "500.00",
    "currency": "USD",
    "quote_limit": 3,
    "quotes_used": 1,
    "quotes_remaining": 2,
    "can_quote": true
  }
}
```

Buyers get `request_limit`, `requests_used`, `requests_remaining`, `can_create_request` and
`ai_posting_allowed` instead of the quote fields; the limit fields are `null` while premium is
active. `plan` is one of `premium`, `trial`, `free`.

### Paywalled surfaces

Out of allowance returns **402** with `error.code = "SUBSCRIPTION_REQUIRED"` and
`error.details.reason` set to one of `trial_quota_exhausted`, `trial_expired`, `premium_expired`,
`request_limit_reached`:

- Dealers: `POST /api/v1/quotes`.
- Buyers: `POST /api/v1/requests`, plus `POST /api/v1/ai/request-preview`, which reports
  `posting_allowed: false` before the hard block.

### Simulated checkout

`POST /api/v1/payment` accepts any well-formed card and activates premium for one year, stacking
onto the current expiry when an unexpired premium is extended. Sessions other than buyer/dealer get
403; malformed card details get 422.

```powershell
curl -X POST http://127.0.0.1:8000/api/v1/payment `
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" `
  -d '{"payment_method":"credit_card","card_number":"4242424242424242","cardholder_name":"Demo Buyer","expiry_month":12,"expiry_year":2027,"cvv":"123"}'
```

The response carries `payment_id`, `status`, `plan`, `amount`, `card_brand`, `card_last4`,
`premium_expires_at` and the refreshed `subscription` block.

## 5. Verification

```powershell
cd "C:\Users\Syed Thameemuddin\Desktop\Cube Simple\drive-deal-dsu\frontend"
npm run lint
npm test
npm run build

cd "C:\Users\Syed Thameemuddin\Desktop\Cube Simple\drive-deal-dsu\backend"
uv run ruff check .
uv run ruff format --check src tests
uv run pytest -q
uv run bandit -q -r src
```

Current status of these gates:

- `uv run ruff check .` — passes.
- `uv run pytest -q` — passes (194 tests), coverage 75.45%, above the 75% floor in `pyproject.toml`.
- `uv run bandit -q -r src` — reports 2 known LOW findings and therefore exits non-zero: B105 false
  positives on the committed OpenAI OAuth token URLs at `src/settings.py:68` and `src/settings.py:96`
  (URLs, not secrets). CI Stage 6 runs `bandit -r src/ -x tests/,migration/,venv/,.venv/ -lll -iii`,
  which fails only on HIGH issues, so the pipeline passes.
- `uv run ruff format --check src tests` — passes. 95 files are checked, so keep this green by running
  `uv run ruff format src tests` before committing; CI Stage 3 fails the pipeline on a formatting diff.

## 6. Containers and CI

`uv.lock` is the single source of truth for backend dependencies. `backend/requirements.txt` has been
deleted; `backend/Dockerfile` creates a virtual environment with `uv sync --frozen --no-dev` and the CI
test stage uses `uv sync --frozen` as well, so the tested tree is the tree that ships.

After changing dependencies run `uv lock` and commit the updated `uv.lock`. The old `requirements.txt`
had drifted from `pyproject.toml` (it pinned `openai==1.82.1` against a `>=2.8.0,<3` requirement and
omitted `pyyaml`, `crawl4ai`, `ddgs` and `langsmith` entirely), which is exactly the class of drift the
lockfile prevents.

Deployment env files are generated by `scripts/generate_env.py` from
`deploy/task-definition/{backend,frontend}.yml`. Add new keys to those files rather than to the script.

