# Video/Audio Calls

Single default architecture for **admin <-> client**, **client <-> client (gated)**, **admin <-> staff**, and **admin <-> admin**. Client uses **Expo**. Staff and admin use **web**. AI/media tap is future work and is **not** required for v1.

## 1. Decisions

| Topic | Decision |
|-------|----------|
| Media plane | **WebRTC through LiveKit SFU**. Do not build raw browser-only P2P for production. |
| Signaling/control | **FastAPI + existing WebSocket** for ring / accept / decline / cancel / timeout / end. |
| Media signaling | **LiveKit** handles SDP, ICE, and media transport. App WebSocket is not a custom WebRTC signaling replacement. |
| Topology | **One room = one 1v1 call**. Two human participants in v1. |
| Room id | **Opaque** UUID-like value. Never derive room names from user ids alone. |
| LiveKit identity | Stable opaque identity such as `usr_<internal_user_id>`. Display name goes in token metadata only. |
| Token minting | **Server only**. Short TTL, typically 5 to 15 minutes. Refresh on reconnect if needed. |
| Join strategy | **Caller token is issued at call creation. Callee token is issued only on accept.** |
| Room creation | **Lazy create** on first join unless ops experience shows eager creation is materially simpler. |
| Ringing | **Web:** WS-driven in-app ringing. **Mobile:** push plus in-app if connected. Deep link into accept screen. |
| Recording | **Off by default** until consent, policy, and retention are approved. |
| Monitoring | Silent monitoring is **out of scope for v1**. Audit through DB plus signaling logs only. |
| Client-to-client | Allowed only if org flag and relationship rule both pass. Deny by default. |

## 2. Roles

- **`client`**: mobile app user.
- **`staff`**: care team user.
- **`admin`**: operational or superuser.

Admin is treated as a policy superset inside an org. Cross-org calls are denied.

## 3. Authorization Matrix

All authorization is enforced in FastAPI before room creation or token minting. A valid LiveKit token never substitutes for business policy.

| Caller | Callee | Verdict | Rule |
|--------|--------|---------|------|
| Admin | Client | Allow | Same org; optional blocklists. |
| Admin | Staff | Allow | Same org. |
| Admin | Admin | Allow | Same org only. |
| Staff | Client | Allow | Assignment or care-team relationship; optional active episode. |
| Staff | Staff | Allow | Same org; optional same-team tightening. |
| Staff | Admin | Allow | Same org escalation path. |
| Client | Staff | Allow | Assigned or care-team only. No arbitrary staff dialing. |
| Client | Client | Allow (gated) | Org flag `client_peer_call_allowed` and relationship row such as `care_circle` or `peer_link`. Otherwise deny. |
| Client | Admin | Deny by default | Prefer callback or ticket flow unless product explicitly changes policy. |

Anything not explicitly allowed is denied.

## 4. Call State Model

Backend and clients should treat call state as a finite state machine.

| State | Meaning | Allowed next states |
|-------|---------|---------------------|
| `ringing` | Invite created, callee not yet accepted | `active`, `declined`, `canceled`, `timeout`, `failed` |
| `active` | At least one side has accepted and join credentials were issued | `ended`, `failed` |
| `declined` | Callee explicitly declined | terminal |
| `canceled` | Caller canceled before accept | terminal |
| `timeout` | Invite expired before accept | terminal |
| `ended` | Active call ended normally | terminal |
| `failed` | Technical failure prevented continuation | terminal |

Implementation rules:

- First successful accept wins. Any later accept returns conflict.
- Cancel is valid only while `ringing`.
- Decline is valid only while `ringing`.
- End is valid only while `active`.
- Timeout worker must update only calls still in `ringing`.
- All mutation endpoints should be idempotent for retried requests.

## 5. Device and Reachability Rules

- Ring all active callee sessions for the same user.
- First accepted device wins; other devices receive a terminal event and must dismiss ringing UI.
- Push may arrive late. Accept must fail cleanly if state is no longer `ringing`.
- If callee is offline, call may still be created and pushed, but it expires at `invite_expires_at`.
- If callee is already in another active call and v1 does not support call waiting, return busy and do not create a second ringing invite.

## 6. End-to-End Flow

Same pipeline for every caller/callee pair. Only policy checks and ring delivery targets differ.

### Preconditions

- Caller is authenticated.
- Caller and callee belong to the same org.
- Relationship rules pass for the given role pair.

### Steps

1. Caller UI sends `POST /api/v1/calls` with `callee_user_id` and `kind`.
2. Server authenticates caller and runs policy checks for roles, org, and relationship constraints.
3. Server rejects busy, blocked, cross-org, or policy-denied requests before any token minting.
4. Server inserts a `calls` row in `ringing` state and inserts `call_participants` rows.
5. Server generates opaque `room_id` and mints the **caller** LiveKit token.
6. Server notifies the callee over WS and/or push with `call_id`, `kind`, caller display metadata, and `expires_at`.
7. Callee declines with `POST /api/v1/calls/{id}/decline`, or caller cancels with `POST /api/v1/calls/{id}/cancel`, or timeout moves the call to `timeout`.
8. Callee accepts with `POST /api/v1/calls/{id}/accept`.
9. Server re-checks the call state, atomically transitions to `active`, lazily creates the LiveKit room if needed, and mints the **callee** token.
10. Clients connect to LiveKit, publish local tracks, and subscribe to remote tracks.
11. Either participant ends the call with `POST /api/v1/calls/{id}/end`, or disconnect policy ends it server-side.
12. Server marks the call terminal, disconnects the room if needed, stops any AI side workers, and broadcasts terminal events.

## 7. Minimum Persistence

Required for v1:

- **`calls`**: `id`, `org_id`, `room_id`, `state`, `kind`, `created_by_user_id`, `accepted_by_user_id`, `invite_expires_at`, `started_at`, `ended_at`, `ended_by_user_id`, `end_reason`.
- **`call_participants`**: `call_id`, `user_id`, `role_at_call_time`, `joined_at`, `left_at`.
- Relationship data for staff-to-client assignment and client-to-client peer links.

Strongly recommended even for v1:

- **`call_events`**: append-only audit rows such as `invite_sent`, `push_sent`, `accepted`, `declined`, `timeout`, `ended`, `join_failed`.

## 8. Unified API Surface

Replace fragmented `/call` mock paths with one surface under `/api/v1/calls`.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/calls` | Start a call, persist invite, return caller join payload. |
| GET | `/calls/{id}` | Return current status for polling or rehydration. |
| POST | `/calls/{id}/accept` | Accept ringing invite and return callee join payload. |
| POST | `/calls/{id}/decline` | Decline ringing invite. |
| POST | `/calls/{id}/cancel` | Caller cancels while still ringing. |
| POST | `/calls/{id}/end` | End an active call. |

Join payload should include at least:

- `call_id`
- `room_id`
- `livekit_url`
- `access_token`
- `expires_at`

Never log token bodies in app analytics.

## 9. Realtime Events

Recommended WS event set:

- `call.invite`
- `call.canceled`
- `call.declined`
- `call.accepted`
- `call.timeout`
- `call.ended`
- `call.state_changed`

Each event should contain `call_id`, resulting `state`, actor when relevant, and a server timestamp.

## 10. Environment and Secrets

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- Push credentials for the existing mobile notification pipeline

Before production, confirm BAA, region, and retention requirements with LiveKit or the chosen hosting model. If compliance later requires self-hosted LiveKit, the application architecture should stay the same.

## 11. Rollout Order

1. LiveKit project setup and server-only token minting in dev.
2. Web two-tab join proof for staff/admin.
3. New `/api/v1/calls` backend contract with persisted state machine.
4. Admin-to-staff calling.
5. Admin-to-client with push delivery.
6. Client-to-staff with assignment checks.
7. Client-to-client behind org flag and relationship rule.

## 12. Relation to Current Repo

- `backend/api/routers/call.py` is still a prototype mock and should not be extended as the real media-plane design.
- `frontend_client/src/api/call.ts` still targets legacy `/call/*` endpoints and will need a contract rewrite, not just a path rename.
- Any staff-side local `getUserMedia` preview should become preview plus publish into the same LiveKit room.

## 13. Future: ASL and LLM Side Channels

Human audio/video remains on LiveKit. ASL and LLM features are side channels and should not block v1 calling.

1. When a call is `active`, decide which participant video is the ASL source. Default to client camera unless product says otherwise.
2. Capture frames via a server LiveKit agent or an approved on-device pipeline.
3. Run inference and emit compact `call.asl.*` events rather than raw tensors.
4. Produce `call.caption` for shared captions and, if allowed, `call.llm.hint` for staff/admin only.
5. Stop workers, flush buffers, and apply retention rules on call teardown.

## 14. Current Usage (Runnable)

### Prerequisites

Before calling works, a resident must have a linked mobile account (see [User Guide](user-guide.md#linking-a-resident-for-calls)).

### Making a call

1. Open **Messages** on the staff web app.
2. Open a **Resident Care** conversation for a resident with a linked mobile account.
3. Click audio or video in the top right.
4. Resident receives an incoming call on their mobile app.
5. Resident accepts → both sides connect via LiveKit.

### Call states

```
ringing → active → ended
       → declined / canceled / timeout (60s) / failed
```

### API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/calls` | Start a call |
| POST | `/api/v1/calls/{id}/accept` | Accept (callee only) |
| POST | `/api/v1/calls/{id}/decline` | Decline (callee only) |
| POST | `/api/v1/calls/{id}/cancel` | Cancel (caller only, ringing) |
| POST | `/api/v1/calls/{id}/end` | End (either party, active) |
| GET | `/api/v1/calls/{id}` | Get call status |
| GET | `/api/v1/calls/{id}/events` | Audit log |

### WebSocket events

| Event | Description |
|-------|-------------|
| `call.invite` | Sent to callee when a call is started |
| `call.accepted` | Sent to caller when callee accepts |
| `call.declined` | Sent to caller when callee declines |
| `call.canceled` | Sent to callee when caller cancels |
| `call.timeout` | Sent to both when invite expires (60s) |
| `call.ended` | Sent to both when call ends |

## 15. Live Transcription (ASR)

Call captions flow: both clients join LiveKit → backend ASR worker joins the room → Whisper transcribes audio → `call.caption` events broadcast over WebSocket.

### Requirements

- Python **3.11** (Whisper/torch may fail on 3.13)
- **ffmpeg** — `winget install Gyan.FFmpeg`
- Whisper model — set `WHISPER_MODEL_SIZE=tiny` for fast local demos

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
ffmpeg -version
python -c "import whisper; print('whisper ok')"
```

### Start with ASR

```powershell
$env:WHISPER_MODEL_SIZE = "tiny"
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Mobile app must use an **Expo dev build** (not Expo Go). Lock LiveKit package versions in `frontend_client/package.json`.

### Common issues

| Error | Fix |
|-------|-----|
| `WinError 2` during ASR | `ffmpeg` not on PATH in the backend terminal |
| No `call.caption` events | Check backend ASR logs; confirm dev build not Expo Go |
| Stuck call state | End stuck calls in DB: `UPDATE calls SET state='ended' WHERE state IN ('ringing','active')` |