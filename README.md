# Deal&Drive

Deal&Drive is a reverse marketplace where buyers describe the vehicle they want, verified dealers compete with itemized out-the-door quotes, and the buyer stays in control through negotiation and purchase completion.

## What is included

- Modern light-first React 19 frontend for buyer, dealer, support, support-admin, and admin roles
- FastAPI backend with JWT authentication, role authorization, audit fields, structured errors, and WebSocket events
- 15-table SQLAlchemy schema, Alembic baseline, and coherent RDS seed data including 120 vehicles
- Buyer requests, dealer demand feed, itemized quotes with vehicle media and documents, bid position and revision, private-contact gate, chat approval, deal status, tickets, and verifications
- Serra buyer advisor and quote comparison workflows using LangGraph: classifier/memory → knowledge base → optional Crawl4AI web fallback → knowledge writeback
- Human approval gate before Serra-created request drafts are published
- Local-storage and S3 document adapters, SQLite local development and PostgreSQL/RDS-ready configuration
- Mock frontend mode so every persona is explorable without cloud or AI credentials

## Run locally

The backend uses [uv](https://docs.astral.sh/uv/) with a committed `backend/uv.lock`. uv manages
`backend/.venv`, so never create or activate a virtual environment by hand.

```powershell
cd backend
uv sync
uv run uvicorn main:app --reload
```

The database must already exist — `backend/main.py` is the only entry point, and it creates the schema on
startup but never creates a database or seeds data. The provisioned RDS instance is already set up; to
install the demo dataset into an empty local database run `uv run python -m tests.demo_data`.

Serra reads its credential from `backend/.env`: `OPENAI_API_KEY` first, then `CODEX_OAUTH_ACCESS_TOKEN`,
then a cached "Sign in with ChatGPT" (SIWC) OAuth token (run `uv run python -m src.codex_login` once
to sign in). With none available, `src/agents/llm.py` leaves the client `None` and answers come from
the deterministic fallback, so a missing credential degrades instead of erroring. Setting
`AI_DISABLED=true` skips LangGraph and OpenAI entirely — the API still streams realistic Serra status,
text, request-preview, and comparison events, so the product can be demonstrated safely without a
credential.

See `RUNNING_GUIDE.md` for credential setup and known issues.

Frontend in a second terminal:

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`. API documentation is at `http://127.0.0.1:8000/api/v1/docs`.

`package.json` lives in `frontend/`, so `npm run dev` only works from that directory (or via `npm run dev --prefix frontend`).

Use `VITE_USE_MOCKS=true` for the self-contained frontend demo. It includes the same streamed Serra preview without calling the backend. Set it to `false` to use the API; with the backend started using `AI_DISABLED=true`, the server supplies deterministic streamed AI previews.

## Seeded accounts

All demo accounts use password `demo1234`.

| Role | Email |
|---|---|
| Buyer | `rahul@drivedeal.demo` |
| Buyer | `adithyaa@drivedeal.demo` |
| Dealer | `naveen@naveemotors.demo` |
| Support | `maya@drivedeal.demo` |
| Support administrator | `priya@drivedeal.demo` |
| Admin | `alex@drivedeal.demo` |

Both support roles sign in through Team access. A support administrator can provision or remove another support administrator from Members. The changed member’s refresh token is revoked and role-aware access-token checks force a fresh sign-in before new controls are available.

## Verification

```powershell
cd frontend
npm run lint
npm test
npm run build

cd ..\backend
uv run ruff check .
uv run pytest -q
uv run bandit -q -r src
```

The backend test gate requires 75% line coverage. The demo dataset lives in `backend/tests/demo_data.py` and is seeded by a test fixture, so it sits outside `src/` and never counts toward coverage. `ruff check`, `pytest` and `bandit` currently pass; `uv run ruff format --check src` still reports 28 pre-existing unformatted files and is worth a separate pass.

## PostgreSQL and cloud configuration

The ignored `backend/.env` is configured for the provided PostgreSQL RDS instance and S3 bucket; no cloud secrets are placed in frontend code or checked-in examples. The database named `drive-deal-dsu` has been created and seeded across every product surface. The application itself has no seeding code path — re-running `uv run python -m tests.demo_data` is idempotent and only fills missing demo rows to the documented targets.

For a deployed environment, move database and AWS credentials into a secret manager or workload role. Rotate the supplied AWS key before deployment because it was shared in plaintext in the development conversation.

## Containers

```powershell
docker compose up --build
```

The compose setup runs the live frontend on port 5173 and API on port 8000 with persistent local volumes. Switch `DATABASE_URL` to the RDS URL only after its username, network access, TLS policy, and secret injection are configured.
