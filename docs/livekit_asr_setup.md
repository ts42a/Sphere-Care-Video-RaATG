# LiveKit ASR Setup

This document explains how to run the backend LiveKit audio transcription feature for the Sphere Care project.

The call transcript flow is:

```txt
frontend_client / frontend_staff joins a LiveKit room
backend joins the same LiveKit room as an ASR worker
backend subscribes to participant audio tracks
backend runs Whisper ASR
backend broadcasts call.caption through WebSocket
frontend_client and frontend_staff display the same transcript
```

## 1. Backend Python version

Use Python 3.11 for the backend.

Python 3.13 is not recommended for this feature because `openai-whisper` and `torch` may fail during transcription.

Check whether Python 3.11 is installed:

```powershell
py -3.11 --version
```

If it is not installed, install it with winget:

```powershell
winget install Python.Python.3.11
```

After installation, close PowerShell and open a new PowerShell window.

## 2. Create backend virtual environment

From the project root:

```powershell
cd C:\sc
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python --version
```

The Python version should be 3.11.x.

Install backend dependencies:

```powershell
pip install --upgrade pip
pip install -r requirements.txt
```

Check the required packages:

```powershell
python -c "import whisper; print('whisper ok')"
python -c "from livekit import rtc; print('livekit rtc ok')"
```

## 3. Install ffmpeg

Whisper requires `ffmpeg` to decode audio files.

Install ffmpeg on Windows:

```powershell
winget install Gyan.FFmpeg
```

Check whether ffmpeg is available:

```powershell
ffmpeg -version
```

If PowerShell says `ffmpeg` is not recognized, add the ffmpeg `bin` folder to the current terminal session:

```powershell
$ffmpegBin = "C:\Users\<username>\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin"
$env:Path = "$env:Path;$ffmpegBin"
ffmpeg -version
```

Replace `<username>` with your Windows username.

The backend terminal that starts Uvicorn must be able to run:

```powershell
ffmpeg -version
```

Otherwise, Whisper ASR will fail with a `WinError 2` error.

## 4. Start backend with ASR enabled

Use the tiny Whisper model for local testing. It is faster and more stable for demo purposes.

```powershell
cd C:\sc
.\.venv\Scripts\Activate.ps1

$ffmpegBin = "C:\Users\<username>\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin"
$env:Path = "$env:Path;$ffmpegBin"
$env:WHISPER_MODEL_SIZE = "tiny"

python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

The first ASR run may download the Whisper model. This is expected.

## 5. Frontend client setup

LiveKit uses native modules, so Expo Go is not supported.

Use an Expo development build.

```powershell
cd C:\sc\frontend_client
npm install
npx expo prebuild --clean
npx expo run:android
```

After the development build is installed, JavaScript only changes can usually be tested with:

```powershell
npx expo start --clear
```

## 6. LiveKit package versions

Keep the LiveKit package versions locked. Do not use `^` for these packages, because npm may upgrade one package without upgrading the matching peer dependency.

Recommended versions:

```json
"@livekit/react-native": "2.9.5",
"@livekit/react-native-expo-plugin": "1.0.1",
"@livekit/react-native-webrtc": "137.0.2",
"livekit-client": "2.15.16"
```

## 7. Android emulator API URLs

For Android emulator, use `10.0.2.2` to access the backend running on the host computer:

```env
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8000/api/v1
EXPO_PUBLIC_WS_BASE_URL=ws://10.0.2.2:8000
```

For a real device, use the computer LAN IP instead:

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:8000/api/v1
EXPO_PUBLIC_WS_BASE_URL=ws://192.168.x.x:8000
```

Do not commit `.env` files to GitHub.

## 8. Expected transcript flow

1. Start the backend.
2. Start `frontend_staff`.
3. Start `frontend_client` using the Expo development build.
4. Start a call.
5. The backend ASR worker joins the same LiveKit room.
6. The backend subscribes to audio tracks.
7. The backend runs Whisper ASR.
8. The backend broadcasts `call.caption` through WebSocket.
9. Both `frontend_client` and `frontend_staff` display the same transcript.

## 9. Common issues

### LiveKit native packages are not installed

Error:

```txt
LiveKit native packages are not installed yet.
```

Fix:

```powershell
cd C:\sc\frontend_client
npm install
npx expo prebuild --clean
npx expo run:android
```

Do not use Expo Go.

### DOMException does not exist

Make sure `frontend_client/index.js` registers LiveKit globals before loading Expo Router:

```js
import { registerGlobals } from "@livekit/react-native";

if (typeof global.DOMException === "undefined") {
  global.DOMException = class DOMException extends Error {
    constructor(message = "", name = "Error") {
      super(message);
      this.name = name;
    }
  };
}

registerGlobals();

require("expo-router/entry");
```

### Whisper cannot find ffmpeg

Error:

```txt
[WinError 2] The system cannot find the file specified
```

Fix:

```powershell
ffmpeg -version
```

If it fails, add the ffmpeg `bin` folder to the current terminal PATH before starting backend.

### Whisper or torch crashes during transcription

Use Python 3.11 and the tiny model:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:WHISPER_MODEL_SIZE = "tiny"
```

### No transcript appears on mobile

Check the mobile log. It should show:

```txt
[call] joined WS call room
WS raw message: {"type":"call.caption", ...}
```

If the call joins successfully but no `call.caption` arrives, check the backend ASR logs.

### Already in another call

If a test call is stuck in `ringing` or `active`, mark it ended in PostgreSQL:

```sql
UPDATE calls
SET state = 'ended',
    ended_at = NOW(),
    end_reason = 'manual_cleanup'
WHERE state IN ('ringing', 'active');
```

## 10. Notes for teammates

Before testing ASR, confirm all of these are true:

```powershell
python --version
python -c "import whisper; print('whisper ok')"
python -c "from livekit import rtc; print('livekit rtc ok')"
ffmpeg -version
```

Also confirm that the mobile app is running from an Expo development build, not Expo Go.
