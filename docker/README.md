# Docker

Run Sphere Care (PostgreSQL + FastAPI API) from the **repository root**.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose v2)
- ~4 GB free disk for the API image (PyTorch / OpenCV / MediaPipe)

### Windows: `docker` is not recognized

Docker is not part of PowerShell until **Docker Desktop** is installed and running.

```powershell
winget install Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
```

Then:

1. **Approve** the UAC prompt if the installer asks for admin rights.
2. **Start Docker Desktop** from the Start menu (wait until the whale icon says *Engine running*).
3. On first launch, accept defaults (**WSL 2** backend is recommended).
4. **Close and reopen** your terminal (or restart Cursor) so `docker` is on your `PATH`.
5. Verify:

```powershell
docker --version
docker compose version
```

If `docker` still fails, add this to your user PATH manually, then reopen the terminal:

`C:\Program Files\Docker\Docker\resources\bin`

### Windows: “Virtualization support not detected”

Docker Desktop needs **CPU virtualization enabled in BIOS/UEFI** (Intel **VT-x** / AMD **SVM**), not only Windows features.

Check in PowerShell:

```powershell
(Get-CimInstance Win32_Processor).VirtualizationFirmwareEnabled
```

If this returns **False**, enable virtualization in firmware:

1. **Restart** and open firmware setup (common keys: **F2**, **F10**, **Del**, **Esc** — often shown briefly at boot; on Surface hold **Volume Up** while powering on).
2. Find a setting named one of:
   - **Intel Virtualization Technology** / **VT-x** / **Intel VT-d**
   - **AMD-V** / **SVM Mode**
   - **Virtualization** (under Advanced → CPU Configuration)
3. Set it to **Enabled**, save (**F10**), reboot.
4. If the option is **missing or greyed out**, your org may lock BIOS — contact IT.

After BIOS is enabled, in an **Admin** PowerShell:

```powershell
wsl --install
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
```

Reboot, start **Docker Desktop**, confirm `(Get-CimInstance Win32_Processor).VirtualizationFirmwareEnabled` is **True**, then run compose.

**Workaround without Docker:** use the native stack in [docs/RUN.md](../docs/RUN.md) (PostgreSQL + `.venv` + uvicorn). Docker is optional for this project.

## Quick start

```powershell
# From repo root (PowerShell)
Copy-Item docker\.env.example docker\.env
docker compose -f docker/docker-compose.yml up --build
```

> **Note:** Default `docker/.env` has `SCVAM_ENABLED=false` and `AI_PIPELINE_ENABLED=false` for a lighter container. Set both to `true` for the full AI demo. Also copy `backend/.env` is **not** used inside Docker — all config goes in `docker/.env`.

A root `.dockerignore` is already provided (kept in sync with `docker/.dockerignore`).

- **Staff web + API:** http://localhost:8000  
- **OpenAPI docs:** http://localhost:8000/docs  
- **Postgres:** `localhost:5432` (user/password/db from `docker/.env`)

Test accounts (seeded on first start): see [docs/RUN.md](../docs/RUN.md) — all passwords `Pass1234`.

## Dev mode (hot reload)

```powershell
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up --build
```

Mounts `backend/` and `frontend_staff/` into the container.

## Mobile / Expo client

The Expo app runs on the host (not in this compose file):

```powershell
cd frontend_client
# Point at the Docker API
# EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
# EXPO_PUBLIC_WS_BASE_URL=ws://127.0.0.1:8000
npx expo start --web --port 3000
```

Add `http://localhost:3000` to `ALLOWED_ORIGINS` in `docker/.env` if needed.

## Configuration

| File | Purpose |
|------|---------|
| `docker/.env` | Secrets and service settings (create from `.env.example`) |
| `docker/docker-compose.yml` | Postgres + API |
| `docker/docker-compose.dev.yml` | Optional reload + bind mounts |
| `docker/Dockerfile` | API image build |
| `docker/.dockerignore` | Build exclusions — **copy to repo root** as `.dockerignore` before build |

### Enable SCVAM / AI pipeline

In `docker/.env`:

```env
SCVAM_ENABLED=true
SCVAM_WORKER_AUTOSTART=true
AI_PIPELINE_ENABLED=true
```

Mount model weights if they are not in the image (large files are excluded from the build via `.dockerignore`):

```yaml
# Add under api.volumes in docker-compose.yml
- ../ai/models:/app/ai/models:ro
```

## Commands

```powershell
# Stop
docker compose -f docker/docker-compose.yml down

# Stop and remove DB + vault volumes
docker compose -f docker/docker-compose.yml down -v

# Rebuild API only
docker compose -f docker/docker-compose.yml build api

# Logs
docker compose -f docker/docker-compose.yml logs -f api
```

## Files in this folder

| File | Description |
|------|-------------|
| `Dockerfile` | Python 3.12 API image |
| `docker-compose.yml` | Production-like stack |
| `docker-compose.dev.yml` | Dev overrides |
| `entrypoint.sh` | Wait for Postgres before starting uvicorn |
| `.env.example` | Environment template |
| `.dockerignore` | Copy to repo root before `docker build` |
