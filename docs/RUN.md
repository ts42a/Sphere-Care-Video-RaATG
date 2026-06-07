# Run Guide (Native Setup)

For Docker, see [docker/README.md](../docker/README.md). For the mobile app, see [mobile_run.md](mobile_run.md).

## Prerequisites

- **Python 3.10+** (3.11 recommended for calls/ASR)
- **Node.js 18+**
- **PostgreSQL 17+**

## 1. Database

```powershell
winget install PostgreSQL.PostgreSQL.17 --accept-package-agreements --accept-source-agreements
psql -U postgres -c "CREATE DATABASE sphere_care;"
```

Default connection: `postgresql://postgres:postgres@localhost:5432/sphere_care`

Override in a root `.env` file:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/sphere_care
```

## 2. Python backend

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Copy `backend/.env.example` to `backend/.env` and set secrets. For calls, add LiveKit:

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
```

Start the API:

```powershell
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

- Staff web: http://localhost:8000
- API docs: http://localhost:8000/docs

## 3. Mobile client (optional)

```powershell
cd frontend_client
npm install
```

Set `frontend_client/.env`:

```env
EXPO_PUBLIC_USE_MOCK_API=false
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
EXPO_PUBLIC_WS_BASE_URL=ws://127.0.0.1:8000
```

```powershell
npx expo start --web --port 3000
```

## Test accounts

All passwords: `Pass1234`

| Role   | Email            |
|--------|------------------|
| Admin  | admin1@test.com  |
| Staff  | staff1@test.com  |
| Staff  | staff2@test.com  |
| Client | client1@test.com |
| Client | client2@test.com |

## Login

- **Admin** — Staff web → Register or Login. Center ID prints in the terminal on first start.
- **Staff** — Staff web → Login with Center ID from admin (e.g. `CTR-83749261`).
- **Client** — Mobile app → Register or Login.

## Link a resident for calls

1. Client: **Settings → Account** → copy Account ID.
2. Admin: **Residents → Add New Resident** → enter Account ID.
3. Client: **Settings → Account** → accept invitation.

## Reset database

```powershell
psql -U postgres -c "DROP DATABASE sphere_care;"
psql -U postgres -c "CREATE DATABASE sphere_care;"
```

Restart the backend after reset.
