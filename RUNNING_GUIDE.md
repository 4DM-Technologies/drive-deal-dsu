# DriveDeal running guide

## 1. Backend

From PowerShell:

```powershell
cd "C:\Users\Syed Thameemuddin\Desktop\Cube Simple\drive-deal-dsu\backend"
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m src.seed
.\.venv\Scripts\python.exe -m src.run --reload --no-ai
```

Open the API docs at `http://127.0.0.1:8000/api/v1/docs`.

`--no-ai` disables the LangGraph/OpenAI workflow and uses a deterministic streamed Serra demonstration. Remove it when an OpenAI credential is present in `backend/.env`.

The ignored backend environment file is already configured for the supplied PostgreSQL RDS database and S3 bucket. The RDS schema and demo dataset have been installed. The current seed includes 22 profiles, 36 buyer requests, 72 dealer quotes, 42 chat messages, 18 deal documents, 24 support tickets, 11 verification cases, 28 AI conversation checkpoints, and 120 vehicle reference rows. Re-running the seed is safe and idempotent.

## 2. Frontend

In a second PowerShell window:

```powershell
cd "C:\Users\Syed Thameemuddin\Desktop\Cube Simple\drive-deal-dsu\frontend"
npm install
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`.

The current `frontend/.env` uses `VITE_USE_MOCKS=true`, which is ideal for a self-contained lead demo. To use the running API, change it to `false` and restart Vite.

## 3. Demo login accounts

Every account uses password `demo1234`.

| Workspace | Email | Home after login |
|---|---|---|
| Buyer | `rahul@drivedeal.demo` | `/home` |
| Buyer | `adithyaa@drivedeal.demo` | `/home` |
| Dealer | `naveen@naveemotors.demo` | `/home` |
| Support | `maya@drivedeal.demo` | `/support` |
| Admin | `alex@drivedeal.demo` | `/support` |

On the login page, pick Buyer or Dealer. Team sign-in is intentionally kept on the restricted team route, and that screen includes a support-access request link. The DriveDeal wordmark always returns an authenticated user to their role home.

## 4. Verification

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
