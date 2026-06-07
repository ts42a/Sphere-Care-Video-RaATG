# Mobile Client Setup

<<<<<<< HEAD
Expo/React Native family app. Requires a running backend — see [RUN.md](RUN.md).
=======
Sphere Care Mobile Client is a mobile application built with Expo and React Native. It supports authentication, booking, messaging, notifications, real time audio and video calling through LiveKit, live call transcript display, and backend generated AI call summaries delivered to the message chat after a call ends.

## Tech Stack

- React Native
- Expo
- Expo Router
- TypeScript
- LiveKit
- WebSocket
- Secure Store
- Live call transcript integration
- AI summary integration
>>>>>>> df987012d636e73237aef9fada0b1aa17787265f

## Requirements

- Node.js 18+, npm
- Android Studio (emulator) or a real device on the same Wi‑Fi as the backend
- **Expo dev build** for full call/LiveKit support (Expo Go is not enough)

<<<<<<< HEAD
## Install
=======
- Node.js
- npm
- Android Studio for Android emulator testing
- Android SDK Platform Tools if installing APK by `adb`
- Expo development build environment
- A backend server running on the same network when testing on a real phone
>>>>>>> df987012d636e73237aef9fada0b1aa17787265f

```powershell
cd frontend_client
npm install
```

## Environment

<<<<<<< HEAD
Create `frontend_client/.env`:
=======
Create a `.env` file in the `frontend_client` project root and add:
>>>>>>> df987012d636e73237aef9fada0b1aa17787265f

```env
EXPO_PUBLIC_USE_MOCK_API=false
EXPO_PUBLIC_API_BASE_URL=http://HOST:8000/api/v1
EXPO_PUBLIC_WS_BASE_URL=ws://HOST:8000
```

<<<<<<< HEAD
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
=======
`EXPO_PUBLIC_API_BASE_URL` can be either:

```text
http://HOST:8000
http://HOST:8000/api/v1
```

`EXPO_PUBLIC_WS_BASE_URL` should be host and port only:

```text
ws://HOST:8000
```

The app appends `/ws` automatically.

Do not put OpenAI API keys, Ollama settings, or backend secrets in the mobile `.env`. AI providers are configured only in `backend/.env`.

### Example for Android emulator
>>>>>>> df987012d636e73237aef9fada0b1aa17787265f

Use `10.0.2.2` when the backend is running on the same computer as the Android emulator:

```env
LIVEKIT_URL=...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

<<<<<<< HEAD
For AI call summaries, see [ai_summary.md](ai_summary.md). For live transcripts, see [call.md](call.md#15-live-transcription-asr).

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Phone can't reach API | Same Wi‑Fi; use LAN IP not `localhost`; backend on `0.0.0.0`; check firewall |
| WebSocket fails | `EXPO_PUBLIC_WS_BASE_URL=ws://LAN_IP:8000` (no `/ws` suffix) |
| Calls won't connect | LiveKit configured; use dev build not Expo Go |
| APK uses old IP | Rebuild APK after changing `.env` |
=======
### Example for real Android phone

A real phone cannot use `localhost` or `10.0.2.2`. Use the computer LAN IP address instead.

Find the computer IP address on Windows:

```powershell
ipconfig
```

Look for the Wi-Fi adapter `IPv4 Address`, for example:

```text
192.168.1.25
```

Then set `frontend_client/.env` like this:

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.25:8000/api/v1
EXPO_PUBLIC_WS_BASE_URL=ws://192.168.1.25:8000
```

The phone and backend computer must be connected to the same Wi-Fi network. The backend must be started with host `0.0.0.0`, not only `127.0.0.1`.

Backend command example:

```powershell
cd C:\sc
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

If the phone cannot connect, check Windows Firewall and allow Python or port `8000` on the private network.

## Backend Requirements for Calling and AI Summary

The backend must provide LiveKit values:

```env
LIVEKIT_URL=...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

Without these values, the app may open call screens but will not be able to join a real LiveKit room.

For AI call summary, configure the AI provider in `backend/.env`, not in the mobile app.

Example using Ollama local model:

```env
AI_LLM_PROVIDER=ollama
AI_OLLAMA_BASE_URL=http://localhost:11434
AI_OLLAMA_MODEL=llama3.2:3b
```

Example using OpenAI:

```env
AI_LLM_PROVIDER=openai
AI_OPENAI_API_KEY=sk-...
AI_OPENAI_BASE_URL=https://api.openai.com/v1
AI_OPENAI_MODEL=gpt-4o-mini
```

For transcript quality, backend ASR settings may also be configured in `backend/.env`:

```env
WHISPER_MODEL_SIZE=small
WHISPER_LANGUAGE=en
ASR_CHUNK_SECONDS=4.0
ASR_OVERLAP_SECONDS=0.5
ASR_MIN_RMS=450
```

## How to Run During Development

Start the Expo development server:

```bash
npm run start
```

For development build testing, use:

```bash
npx expo start --dev-client --clear
```

Run Android build from Expo:

```bash
npm run android
```

Run web version:

```bash
npm run web
```

## Download and Test on a Real Android Phone

There are two common ways to test on a real phone.

## Option A: Expo Dev Client Testing

Use this when you are actively developing and want to reload JavaScript changes without rebuilding the APK every time.

### Steps

1. Make sure the backend is running on `0.0.0.0`.
2. Make sure the phone and computer are on the same Wi-Fi network.
3. Set `frontend_client/.env` to the computer LAN IP.
4. Start Expo dev client:

```powershell
cd C:\sc\frontend_client
npx expo start --dev-client --clear
```

5. Open the installed Sphere Care dev build on the phone.
6. Connect to the Metro server shown in the terminal.
7. Test login, messages, audio call, video call, transcript, and post-call AI summary.

### When do you need to reinstall the dev build?

You usually do not need to reinstall the app after changing TypeScript, JavaScript, or styling.

You need to rebuild and reinstall when:

- A new native package is added
- `app.json` native configuration changes
- Android permissions or package name changes
- You are no longer using the same installed dev client build

## Option B: Build a Debug APK and Install It on a Real Phone

Use this when you want a more stable demo APK that can be downloaded and opened without the Metro dev server.

### Step 1: Set the real device environment

Before building the APK, make sure `frontend_client/.env` points to the backend computer LAN IP:

```env
EXPO_PUBLIC_USE_MOCK_API=false
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.25:8000/api/v1
EXPO_PUBLIC_WS_BASE_URL=ws://192.168.1.25:8000
```

Replace `192.168.1.25` with your real computer IP.

### Step 2: Build the debug APK

On Windows PowerShell:

```powershell
cd C:\sc\frontend_client\android
.\gradlew assembleDebug
```

The APK will be generated here:

```text
frontend_client/android/app/build/outputs/apk/debug/app-debug.apk
```

### Step 3A: Install by USB and adb

Enable Developer Options and USB debugging on the Android phone. Connect the phone to the computer by USB.

Check the device:

```powershell
adb devices
```

Install or update the APK:

```powershell
adb install -r C:\sc\frontend_client\android\app\build\outputs\apk\debug\app-debug.apk
```

### Step 3B: Install by file download

You can also upload `app-debug.apk` to Google Drive, OneDrive, or another file sharing service.

On the phone:

1. Download the APK file.
2. Open the APK.
3. Allow installation from unknown sources if Android asks.
4. Install the app.
5. Open Sphere Care and test the app.

### Step 4: Test with backend running

The APK still needs the backend computer to be online if the app is using a local backend IP. Start the backend before opening the app:

```powershell
cd C:\sc
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

If the backend IP changes, rebuild and reinstall the APK because the API URL is packaged into the app bundle.

## Recommended Startup Order

1. Start Ollama if using local AI summary.
2. Start the backend server.
3. Confirm database and API are working.
4. Confirm WebSocket is working.
5. Confirm LiveKit is configured on the backend.
6. Confirm backend ASR and transcript service are working.
7. Start frontend_staff if staff side testing is needed.
8. Start the mobile client or open the installed APK.

## Project Structure

```text
app/
  auth/
  (tab)/
  call/
    audio/
    video/
  messages/
  profile/
  settings/

src/
  api/
  components/
  hooks/
  services/
  theme/
  types/
```

## Architecture Overview

### `app/`

Page routes using Expo Router.

### `src/api/`

Handles REST API requests and response mapping.

### `src/services/`

Handles business logic such as call state, messaging flow, and WebSocket integration.

### `src/services/rtc/`

Handles LiveKit RTC logic for audio and video calls.

### `src/hooks/`

Reusable state and feature hooks such as call session and transcript handling.

### `src/components/`

Reusable UI components for pages, calls, headers, overlays, and mini call bar.

### `src/types/`

Shared TypeScript type definitions.

## Call Flow

The call system uses:

- REST API to create and manage call sessions
- WebSocket for real time call events
- LiveKit for audio and video media
- Shared call state for audio and video modes

Audio and video calls use the same call session and room, which makes mode switching more stable and closer to a production level design.

## Call Transcript and AI Summary Flow

During an audio or video call, backend ASR generates live captions and sends them to the mobile client through WebSocket events.

When the call ends:

1. The backend reads the accumulated transcript.
2. The backend generates two AI summary versions:
   - `staff_summary` for staff side context
   - `patient_summary` for the mobile client
3. The backend stores both summaries in `calls.ai_summary`.
4. The backend automatically sends the patient friendly summary into the message chat.
5. The mobile client receives the summary in the chat without manually sending a local summary.

The mobile app should treat the backend chat message as the source of truth for post-call AI summaries.

## Important Notes

- Do not rely on Expo Go for full call testing.
- Make sure backend API, WebSocket, LiveKit, and AI provider are available before testing calls.
- If testing on emulator, avoid using `localhost` unless properly mapped.
- If testing on a real phone, use the computer LAN IP address.
- Do not put OpenAI API keys or backend secrets in the mobile `.env`.
- For standalone APK testing, rebuild and reinstall the APK after changing frontend code or frontend `.env`.
- For Expo dev client testing, reload the dev client after changing JavaScript or TypeScript code.
- For better transcript quality, test with two separate devices and avoid speaker echo.
- At least one side should use earphones during demo calls if possible.
- If call connection fails, first check backend LiveKit configuration.

## Basic Testing Checklist

- Login works
- Booking pages load correctly
- Messages list loads
- Chat room opens correctly
- Audio call connects
- Video call connects
- Audio can switch to video
- Incoming call overlay works
- Mini call bar updates correctly
- Remote hang up clears the call state correctly
- Live transcript appears during audio call
- Live transcript appears during video call
- Ending a call creates an AI summary message in chat
- Client can see the patient friendly AI summary
- Staff can see the same chat summary in the shared conversation
- Summary does not duplicate after returning to the message page
- Summary does not show raw JSON
- Summary does not show speaker IDs such as `[5]` or `[1000001]`

## Real Device Troubleshooting

### The phone cannot connect to backend

Check these items:

1. Backend is running with `--host 0.0.0.0`.
2. Phone and computer are on the same Wi-Fi network.
3. Mobile `.env` uses computer LAN IP, not `localhost`.
4. Windows Firewall allows Python or port `8000`.
5. Open this from the phone browser:

```text
http://192.168.1.25:8000/docs
```

If the page does not open, the app also cannot connect.

### WebSocket does not work

Check `EXPO_PUBLIC_WS_BASE_URL`:

```env
EXPO_PUBLIC_WS_BASE_URL=ws://192.168.1.25:8000
```

Do not add `/ws` manually because the app appends `/ws` automatically.

### APK still connects to old IP

The APK contains the frontend environment values used at build time. Update `frontend_client/.env`, rebuild the APK, and reinstall it.

### Transcript is inaccurate

Try these during demo:

1. Use two separate devices.
2. Keep phone and computer apart.
3. Use earphones on at least one side.
4. Speak slowly in complete sentences.
5. Avoid both devices playing audio through speakers in the same room.

### AI summary does not appear

Check these items:

1. Transcript appears during the call.
2. Backend terminal has no 500 error.
3. AI provider is configured in `backend/.env`.
4. Ollama is running if using local AI.
5. OpenAI account has API quota if using OpenAI.
6. Message conversation exists between the staff and client.

## Useful Commands

Install dependencies:

```bash
npm install
```

Start Expo:

```bash
npm run start
```

Start Expo dev client with cache clear:

```bash
npx expo start --dev-client --clear
```

Run Android:

```bash
npm run android
```

Build Android debug APK on Windows:

```powershell
cd android
.\gradlew assembleDebug
```

Install APK by adb:

```powershell
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Run web:

```bash
npm run web
```

Run lint:

```bash
npm run lint
```
>>>>>>> df987012d636e73237aef9fada0b1aa17787265f
