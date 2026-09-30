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
uv run python -m src.seed
uv run python -m src.run --reload
```

Open the API docs at `http://127.0.0.1:8000/api/v1/docs`.

### What each step does

| Command | Purpose |
|---|---|
| `uv sync` | Creates/reuses `backend/.venv` and installs the project plus the `dev` dependency group (pytest, pytest-asyncio, pytest-cov, ruff, bandit). |
| `uv run python -m src.seed` | Installs the demo dataset. Idempotent — safe to re-run; it only fills rows that are missing. |
| `uv run python -m src.run --reload` | Starts uvicorn on `127.0.0.1:8000`. This is the normal application flow. |
| `uv run python -m src.run --reload --no-ai` | Explicit opt-in demo mode (see below). |

Optional: `uv run python -m src.provision` creates the configured PostgreSQL database when the RDS
instance is empty. It refuses to run unless `DATABASE_URL` points at a named PostgreSQL database.

### Serif AI layer: normal flow versus `--no-ai`

`--no-ai` is **opt-in**. Without it, the normal application flow runs and the Serra LangGraph
workflow executes. Add the flag only when you want a credential-free product demo.

| | Normal flow | `--no-ai` |
|---|---|---|
| LangGraph graphs | Built and executed | Skipped entirely |
| Serra answer | Model output, or the deterministic fallback | Canned scripted answer |
| Where | `src/agents/serra/graph.py` | `src/services/ai_service.py:23-26` → `_stream_demo()` |

### LLM credentials

Credentials are read from `backend/.env` only. The client prefers `OPENAI_API_KEY` and falls back to
`CODEX_OAUTH_ACCESS_TOKEN`:

```env
OPENAI_API_KEY=
CODEX_OAUTH_ACCESS_TOKEN=
OPENAI_MODEL=gpt-5.6-sol
OPENAI_REASONING_EFFORT=medium
```

If neither key is set, `src/agents/llm.py:22-23` leaves the client as `None` and every request uses
the deterministic fallback text. The API stays fully functional, so a missing credential degrades
rather than errors. This is the current state of `backend/.env`, so the live path falls back unless
a key is added.

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