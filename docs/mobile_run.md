# Mobile Client Setup

Expo/React Native family app. Requires a running backend — see [RUN.md](RUN.md).

## Requirements

- Node.js 18+, npm
- Android Studio (emulator) or a real device on the same Wi‑Fi as the backend
- **Expo dev build** for full call/LiveKit support (Expo Go is not enough)

## Install

```powershell
cd frontend_client
npm install
```

## Environment

```powershell
Copy-Item .env.example .env
```

Or create `frontend_client/.env` manually:

```env
EXPO_PUBLIC_USE_MOCK_API=false
EXPO_PUBLIC_API_BASE_URL=http://HOST:8000/api/v1
EXPO_PUBLIC_WS_BASE_URL=ws://HOST:8000
```

The app appends `/ws` automatically. Do not put backend secrets in this file.

| Target | HOST |
|--------|------|
| Web / same machine | `127.0.0.1` |
| Android emulator | `10.0.2.2` |
| Real phone | Computer LAN IP (from `ipconfig`) |

Backend must run with `--host 0.0.0.0`. Allow port 8000 through Windows Firewall for real-device testing.

## Run

**Web (quick test):**

```powershell
npx expo start --web --port 3000
```

**Android dev build (calls):**

```powershell
npx expo prebuild --clean
npx expo run:android
npx expo start --dev-client --clear
```

## Backend requirements for calls

In `backend/.env`:

```env
LIVEKIT_URL=...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

For AI call summaries, see [ai_summary.md](ai_summary.md). For live transcripts, see [call.md](call.md#15-live-transcription-asr).

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Phone can't reach API | Same Wi‑Fi; use LAN IP not `localhost`; backend on `0.0.0.0`; check firewall |
| WebSocket fails | `EXPO_PUBLIC_WS_BASE_URL=ws://LAN_IP:8000` (no `/ws` suffix) |
| Calls won't connect | LiveKit configured; use dev build not Expo Go |
| APK uses old IP | Rebuild APK after changing `.env` |
