# Run Guide (Native Setup)

Recommended for full AI features (SCVAM, ASL, Whisper). For Docker, see [docker/README.md](../docker/README.md). For the mobile app, see [mobile_run.md](mobile_run.md).

## Prerequisites

- **Python 3.11** (recommended for calls/ASR; 3.10+ works for core app)
- **Node.js 18+**
- **PostgreSQL 17+**
- **~8 GB RAM** and **~5 GB disk** for `pip install -r requirements.txt` (PyTorch, Whisper, OpenCV)

> First `pip install` can take 15–30 minutes depending on network speed.

## 1. Database

```powershell
winget install PostgreSQL.PostgreSQL.17 --accept-package-agreements --accept-source-agreements
psql -U postgres -c "CREATE DATABASE sphere_care;"
```

Default connection (if you set password `postgres` during install):

`postgresql://postgres:postgres@localhost:5432/sphere_care`

## 2. Backend environment

The app reads **`backend/.env` only** (not a root `.env`):

```powershell
Copy-Item backend\.env.example backend\.env
```

Edit `backend/.env` — at minimum set `DATABASE_URL` to match your Postgres password:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/sphere_care
SECRET_KEY=change-me-to-a-long-random-string
```

Optional — required for **video/audio calls**:

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
```

Optional — disable SCVAM worker on low-spec machines:

```env
SCVAM_ENABLED=false
SCVAM_WORKER_AUTOSTART=false
```

## 3. Python backend

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

- **Staff web:** http://localhost:8000
- **API docs:** http://localhost:8000/docs

Test data seeds automatically on first start. Watch the terminal for the **Center ID** (staff login needs it).

## 4. Mobile client (optional)

```powershell
cd frontend_client
Copy-Item .env.example .env
npm install
npx expo start --web --port 3000
```

For calls on a real device, see [mobile_run.md](mobile_run.md) (Expo dev build + LiveKit required).

## What works without extra setup

| Feature | Works out of the box? |
|---------|----------------------|
| Staff web login, dashboard, residents | Yes |
| Messaging, bookings, records | Yes |
| Test accounts (seeded) | Yes |
| Video/audio calls | No — needs LiveKit in `backend/.env` |
| Live call transcripts (ASR) | No — needs LiveKit + Python 3.11 + ffmpeg |
| SCVAM safety flags | Partial — worker runs; needs recordings + vault setup |
| AI summaries | Fallback only — set `AI_LLM_PROVIDER=ollama` or `openai` for real summaries |

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

- **Admin** — http://localhost:8000 → Login with `admin1@test.com` / `Pass1234`
- **Staff** — Login with `staff1@test.com` / `Pass1234` + **Center ID** from terminal (e.g. `CTR-83749261`)
- **Client** — Mobile app → `client1@test.com` / `Pass1234`

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
