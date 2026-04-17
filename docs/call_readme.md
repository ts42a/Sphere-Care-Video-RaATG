# Sphere Care

AI-Powered Aged Care Platform — Staff web app + Client mobile app + LiveKit video/audio calling.

---

## Requirements

- Python 3.10+
- Node.js 18+
- PostgreSQL 17

---

## 1. Database Setup

```powershell
winget install PostgreSQL.PostgreSQL.17 --accept-package-agreements --accept-source-agreements

$pgPath = "C:\Program Files\PostgreSQL\17\bin"
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$pgPath", "User")
$env:Path += ";$pgPath"
```

Restart your terminal, then create the database:

```powershell
psql -U postgres -c "CREATE DATABASE sphere_care;"
```

---

## 2. Environment Setup

Create a `.env` file in the project root:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sphere_care
SECRET_KEY=spherecare2025
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
LIVEKIT_URL=wss://your-livekit-url.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
OPENAI_API_KEY=sk-...
```

---

## 3. Python Setup

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

---

## 4. Frontend Setup (first time only)

```powershell
cd frontend_client
npm install
cd ..
```

---

## 5. Start the Servers

**Backend (Terminal 1)**
```powershell
.venv\Scripts\Activate.ps1
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

- Staff web app: http://localhost:8000
- API docs: http://localhost:8000/docs

**Mobile Client (Terminal 2)**
```powershell
cd frontend_client
npx expo start --web --port 3000
```

- Mobile web app: http://localhost:3000

---

## 6. Test Accounts

All passwords: `Pass1234`

| Role   | Email            |
|--------|------------------|
| Admin  | admin1@test.com  |
| Staff  | staff1@test.com  |
| Staff  | staff2@test.com  |
| Client | client1@test.com |
| Client | client2@test.com |

> IDs like `CTR-XXXXXXXX`, `ACC-XXXXXXXX`, `STF-XXXXXXXX`, and `RES-XXXXXXXX` are randomly generated and printed in the terminal when the server starts with a fresh database.

---

## 7. How to Log In

- **Admin** — Open staff web → Register or Log in. No center ID needed.
- **Staff** — Open staff web → Log in → Enter the Center ID from the admin's terminal (e.g. `CTR-83749261`).
- **Client** — Open mobile client → Register or Log in. No center ID needed.

---

## 8. How to Add a Resident

1. Client registers on the mobile app → goes to **Settings → Account** → copies their **Account ID** (e.g. `ACC-47291038`)
2. Admin logs in on staff web → opens **Residents** page → clicks **Add New Resident**
3. Admin enters the client's Account ID → sends the invitation
4. Client opens **Settings → Account** on mobile app → sees the invitation under **Center Invitations**
5. Client clicks **Accept** to join the center

---

## 9. Video / Audio Calling

Calling requires a resident to have a linked mobile account (see step 8 above).

**To make a call:**
1. Open the **Messages** page on the staff web app
2. Open a **Resident Care** conversation for a resident who has a linked mobile account
3. Click the 📞 or 📹 button in the top right
4. The resident will receive an incoming call notification on their mobile app
5. Resident accepts → both sides connect via LiveKit

**Call states:** ringing → active → ended / declined / canceled / timeout

---

## 10. Reset the Database

```powershell
psql -U postgres -c "DROP DATABASE sphere_care;"
psql -U postgres -c "CREATE DATABASE sphere_care;"
```

Then restart the backend server.

---

## Project Structure

```
backend/
  api/routers/
    call.py          # Call state machine — POST /calls, accept, decline, cancel, end
    ws.py            # WebSocket endpoint
    messages.py      # Messaging
    residents.py     # Resident management
  models/            # SQLAlchemy models
  schemas/           # Pydantic schemas
  ws/
    ws_manager.py    # WebSocket connection manager
  main.py            # FastAPI app + lifespan

frontend_staff/      # Staff web app (HTML/JS)
  src/pages/
    message.html     # Messaging + calling UI
  src/style/js/
    message.js       # Call flow + LiveKit integration
    script.js        # Shared auth + navigation

frontend_client/     # Client mobile app (Expo/React Native)

agent.py             # LiveKit voice agent — future work (spec Section 13)
requirements.txt
```

---

## Architecture

```
Staff Web (browser)
    │
    ├── POST /api/v1/calls          → creates call, mints caller LiveKit token
    ├── WS  /ws                     → receives call.accepted / call.ended events
    └── LiveKit SDK                 → connects to LiveKit room for media

Client Mobile App
    │
    ├── WS  /ws                     → receives call.invite event
    ├── POST /api/v1/calls/{id}/accept → mints callee LiveKit token
    └── LiveKit SDK                 → connects to LiveKit room for media

Backend (FastAPI)
    ├── Call state machine          → ringing → active → ended/declined/canceled/timeout
    ├── LiveKit token minting       → server-side only, short TTL
    └── WebSocket broadcast         → notifies both participants of state changes
```
