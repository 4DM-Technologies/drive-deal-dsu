# DriveDeal frontend running guide

The React application is intentionally light-first and restrained: four reusable vehicle assets, warm neutral surfaces, accessible contrast, strong typography, and responsive layouts. It supports buyer, dealer, support, and admin journeys.

## Start the self-contained demo

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`. `frontend/.env` defaults to `VITE_USE_MOCKS=true`, so no backend or cloud keys are required.

`package.json` lives in `frontend/`, not the repository root. Running `npm run dev` from the root fails with `ENOENT ... package.json`; use `cd frontend` (above) or `npm run dev --prefix frontend`.

Choose Buyer, Dealer, or Team directly on the redesigned sign-in screen. Developer persona shortcuts are collapsed by default. All seeded/demo personas use `demo1234`:

| Persona | Email |
|---|---|
| Buyer | `rahul@drivedeal.demo` |
| Dealer | `naveen@naveemotors.demo` |
| Support | `maya@drivedeal.demo` |
| Admin | `alex@drivedeal.demo` |

## Connect the API

Start the backend on port 8000. It is managed with [uv](https://docs.astral.sh/uv/) from the
`backend` directory:

```powershell
cd ..\backend
uv sync
uv run python -m src.run --reload
```

This runs the normal application flow. To demonstrate Serra without any OpenAI credential, add the
explicit opt-in flag instead:

```powershell
uv run python -m src.run --reload --no-ai
```

Then set the frontend environment:

```env
VITE_USE_MOCKS=false
VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1
VITE_WS_BASE_URL=ws://127.0.0.1:8000/api/v1/ws
```

The UI talks only through `DriveDealClient`; switching implementations does not require screen changes. With `--no-ai`, LangGraph/OpenAI is disabled but Serra still streams deterministic progress, a request-preview card, and quote comparisons. With `VITE_USE_MOCKS=true`, the frontend provides the same demo without needing the backend at all.

## Quality commands

```powershell
npm run lint
npm test
npm run build
npm run preview
```

## Key walkthroughs

- Buyer: dashboard → request detail → quote comparison → approved negotiation → accepted deal
- Serra: use the bottom-right prompt or permanent Ask Serra navigation → open a remembered chat → watch agent activity → review/edit request preview → explicitly approve publication
- Compare: select two to five quotes → review OTD ranking, missing-field warnings, and rationale
- Dealer: request feed → itemized quote → chat approval → deal steps → documents and inventory
- Support/admin: tickets → verifications → account activation and team management

See the root `README.md` for backend, database, Docker, environment, and security instructions.
