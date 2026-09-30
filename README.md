# DriveDeal

DriveDeal is a reverse marketplace where buyers describe the vehicle they want, verified dealers compete with itemized out-the-door quotes, and the buyer stays in control through negotiation and purchase completion.

## What is included

- Modern light-first React 19 frontend for buyer, dealer, support, and admin roles
- FastAPI backend with JWT authentication, role authorization, audit fields, structured errors, and WebSocket events
- 15-table SQLAlchemy schema, Alembic baseline, and coherent RDS seed data including 120 vehicles
- Buyer requests, dealer demand feed, itemized quotes with vehicle media and documents, bid position and revision, private-contact gate, chat approval, deal status, tickets, and verifications
- Serra buyer advisor and quote comparison workflows using LangGraph: classifier/memory → knowledge base → optional Crawl4AI web fallback → knowledge writeback
- Human approval gate before Serra-created request drafts are published
- Local-storage and S3 document adapters, SQLite local development and PostgreSQL/RDS-ready configuration
- Mock frontend mode so every persona is explorable without cloud or AI credentials

## Run locally

Backend with Serra demo mode (PowerShell, recommended until an OpenAI key is available):

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m src.seed
.\.venv\Scripts\python.exe -m src.run --reload --no-ai
```

`--no-ai` completely skips LangGraph and OpenAI execution. The API still streams realistic Serra status, text, request-preview, and comparison events so the product can be demonstrated safely. Remove `--no-ai` after setting `OPENAI_API_KEY` (or the configured OAuth token) to run the real workflow.

Frontend in a second terminal:

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`. API documentation is at `http://127.0.0.1:8000/api/v1/docs`.

Use `VITE_USE_MOCKS=true` for the self-contained frontend demo. It includes the same streamed Serra preview without calling the backend. Set it to `false` to use the API; with the backend started using `--no-ai`, the server supplies deterministic streamed AI previews.

## Seeded accounts

All demo accounts use password `demo1234`.

| Role | Email |
|---|---|
| Buyer | `rahul@drivedeal.demo` |
| Buyer | `adithyaa@drivedeal.demo` |
| Dealer | `naveen@naveemotors.demo` |
| Support | `maya@drivedeal.demo` |
| Admin | `alex@drivedeal.demo` |

## Verification

```powershell
cd frontend
npm run lint
npm test
npm run build

cd ..\backend
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\pytest.exe -q
.\.venv\Scripts\bandit.exe -q -r src
```

The backend test gate requires 75% line coverage. The seed script is excluded because it is a data fixture/CLI, not runtime business logic.

## PostgreSQL and cloud configuration

The ignored `backend/.env` is configured for the provided PostgreSQL RDS instance and S3 bucket; no cloud secrets are placed in frontend code or checked-in examples. The database named `drive-deal-dsu` has been created and seeded across every product surface. Run `python -m src.seed` again safely: it is idempotent and only fills missing demo rows to the documented targets.

For a deployed environment, move database and AWS credentials into a secret manager or workload role. Rotate the supplied AWS key before deployment because it was shared in plaintext in the development conversation.

## Containers

```powershell
docker compose up --build
```

The compose setup runs the live frontend on port 5173 and API on port 8000 with persistent local volumes. Switch `DATABASE_URL` to the RDS URL only after its username, network access, TLS policy, and secret injection are configured.
