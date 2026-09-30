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
uv run python -m src.seed
uv run python -m src.run --reload
```

This starts the normal application flow. Add `--no-ai` to skip LangGraph and OpenAI entirely — the
API still streams realistic Serra status, text, request-preview, and comparison events, so the
product can be demonstrated safely without a credential.

Serra reads its credential from `backend/.env`, preferring `OPENAI_API_KEY` and falling back to
`CODEX_OAUTH_ACCESS_TOKEN`. With neither set, `src/agents/llm.py` leaves the client `None` and
answers come from the deterministic fallback, so a missing key degrades instead of erroring.

See `RUNNING_GUIDE.md` for credential setup, the Postgres provisioning step, and known issues.

Frontend in a second terminal:

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`. API documentation is at `http://127.0.0.1:8000/api/v1/docs`.

`package.json` lives in `frontend/`, so `npm run dev` only works from that directory (or via `npm run dev --prefix frontend`).

Use `VITE_USE_MOCKS=true` for the self-contained frontend demo. It includes the same streamed Serra preview without calling the backend. Set it to `false` to use the API; with the backend started using `--no-ai`, the server supplies deterministic streamed AI previews.

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

The backend test gate requires 75% line coverage. The seed script is excluded because it is a data fixture/CLI, not runtime business logic. `ruff check`, `pytest` and `bandit` currently pass; `uv run ruff format --check src` still reports 28 pre-existing unformatted files and is worth a separate pass.

## PostgreSQL and cloud configuration

The ignored `backend/.env` is configured for the provided PostgreSQL RDS instance and S3 bucket; no cloud secrets are placed in frontend code or checked-in examples. The database named `drive-deal-dsu` has been created and seeded across every product surface. Run `uv run python -m src.seed` again safely: it is idempotent and only fills missing demo rows to the documented targets.

For a deployed environment, move database and AWS credentials into a secret manager or workload role. Rotate the supplied AWS key before deployment because it was shared in plaintext in the development conversation.

## Containers

```powershell
docker compose up --build
```

The compose setup runs the live frontend on port 5173 and API on port 8000 with persistent local volumes. Switch `DATABASE_URL` to the RDS URL only after its username, network access, TLS policy, and secret injection are configured.
