# 1. Install Requirements

You need these installed on your computer before starting:

- **Python 3.10+** — https://www.python.org/downloads/
- **Node.js 18+** — https://nodejs.org/
- **PostgreSQL** — will be installed via terminal in step 2

# 2. Database Setup (PostgreSQL)
install PostgreSQL:
winget install PostgreSQL.PostgreSQL.17 --accept-package-agreements --accept-source-agreements
$pgPath = "C:\Program Files\PostgreSQL\17\bin"
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$pgPath", "User")
$env:Path += ";$pgPath"

Restart your terminal after this step

During installation, PostgreSQL asks you to set a password. Use `postgres`.

Then run this to create the database:
psql -U postgres -c "CREATE DATABASE sphere_care;"

> The app connects to `postgresql://postgres:postgres@localhost:5432/sphere_care` by default.
> You can change this by creating a `.env` file in the project root with:
> DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/sphere_care


# 3. Python Setup

Create a virtual environment (first time only)
python -m venv .venv


Activate the virtual environment
.venv\Scripts\Activate.ps1


Install Python packages

pip install -r requirements.txt
```

---

# 4. Frontend Setup (first time only)

```powershell
cd frontend_client
npm install
cd ..
```

---

# 5. Start the Servers

### Start Backend (Terminal 1)

```powershell
.venv\Scripts\Activate.ps1
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

- Staff web app: http://localhost:8000
- API docs: http://localhost:8000/docs

### Start Mobile Client (Terminal 2)

```powershell
cd frontend_client
npx expo start --web --port 3000
```

- Mobile web app: http://localhost:3000

---

# 6. Test Accounts

All passwords: `Pass1234`

| Role   | Email              |
|--------|--------------------|
| Admin  | admin1@test.com    |
| Staff  | staff1@test.com    |
| Staff  | staff2@test.com    |
| Client | client1@test.com   |
| Client | client2@test.com   |

> **Note:** IDs like `CTR-XXXXXXXX`, `ACC-XXXXXXXX`, `STF-XXXXXXXX`, and `RES-XXXXXXXX` are randomly generated. They show up in the terminal when the server starts with a fresh database.

---

# 7. How to Log In

- **Admin** — Open staff web → Register or Log in. No center ID needed. Your Center ID is printed in the terminal when the server starts.
- **Staff** — Open staff web → Log in → Enter the Center ID from the admin's terminal (e.g. `CTR-83749261`).
- **Client** — Open mobile client → Register or Log in. No center ID needed.

---

# 8. How to Add a Resident

1. Client registers on the mobile app → goes to **Settings → Account** → copies their **Account ID** (e.g. `ACC-47291038`)
2. Admin logs in on staff web → opens **Residents** page → clicks **Add New Resident**
3. Admin enters the client's Account ID → sends the invitation
4. Client opens **Settings → Account** on mobile app → sees the invitation under **Center Invitations**
5. Client clicks **Accept** to join the center. Clicking **Decline** does nothing.

---

# 9. Reset the Database

If you want a fresh start, drop and recreate the database:

```powershell
psql -U postgres -c "DROP DATABASE sphere_care;"
psql -U postgres -c "CREATE DATABASE sphere_care;"
```

Then restart the backend server.

---

# 10. Stop the Servers

Press `Ctrl+C` in each terminal.
