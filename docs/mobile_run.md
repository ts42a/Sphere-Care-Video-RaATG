# Sphere Care Mobile Client

Sphere Care Mobile Client is a mobile application built with Expo and React Native. It supports authentication, booking, messaging, notifications, and real time audio and video calling through LiveKit.

## Tech Stack

- React Native
- Expo
- Expo Router
- TypeScript
- LiveKit
- WebSocket
- Secure Store

## Requirements

Please install the following before running the project:

- Node.js
- npm
- Android Studio for Android emulator testing
- Expo development build environment

For call features, a development build is recommended because LiveKit and WebRTC native capabilities may not work correctly in Expo Go.

## Installation

Go to the project folder:

```bash
cd frontend_client
```

Install dependencies:

```bash
npm install
```

## Environment Variables

Create a `.env` file in the project root and add:

```env
EXPO_PUBLIC_USE_MOCK_API=false
EXPO_PUBLIC_API_BASE_URL=http://YOUR_BACKEND_HOST:8000/api/v1
EXPO_PUBLIC_WS_BASE_URL=ws://YOUR_BACKEND_HOST:8000
```

`EXPO_PUBLIC_API_BASE_URL` can be either:
- `http://HOST:8000`
- `http://HOST:8000/api/v1`

`EXPO_PUBLIC_WS_BASE_URL` should be host + port only (`ws://HOST:8000`).  
The app appends `/ws` automatically.

### Example for Android emulator

```env
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8000/api/v1
EXPO_PUBLIC_WS_BASE_URL=ws://10.0.2.2:8000
```

## How to Run

Start the Expo development server:

```bash
npm run start
```

Run Android build:

```bash
npm run android
```

Run web version:

```bash
npm run web
```

## Recommended Startup Order

1. Start the backend server
2. Confirm database and API are working
3. Confirm WebSocket is working
4. Confirm LiveKit is configured on the backend
5. Start the mobile client

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

## Important Notes

- Do not rely on Expo Go for full call testing
- Make sure backend API, WebSocket, and LiveKit are all available before testing calls
- If testing on emulator, avoid using `localhost` unless properly mapped
- If call connection fails, first check backend LiveKit configuration

## Backend Requirements for Calling

The backend must provide:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

Without these values, the app may open call screens but will not be able to join a real LiveKit room.

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

## Useful Commands

Install dependencies:

```bash
npm install
```

Start Expo:

```bash
npm run start
```

Run Android:

```bash
npm run android
```

Run web:

```bash
npm run web
```

Run lint:

```bash
npm run lint
```

