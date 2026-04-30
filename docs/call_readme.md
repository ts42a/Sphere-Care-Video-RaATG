# Sphere Care — Video / Audio Calling

> This file describes the current runnable behavior.
> `docs/call.md` is the target architecture/design guide and may include future-state notes.

## Prerequisites

Before calling works, a resident must have a linked mobile account.

1. Client registers on the mobile app → **Settings → Account** → copy Account ID (e.g. `ACC-47291038`)
2. Admin on staff web → **Residents** → **Add New Resident** → enter the Account ID
3. Client on mobile → **Settings → Account** → accept the invitation

Seed residents (e.g. Dorothy Williams) do not have linked accounts and cannot receive calls.

---

## Making a Call

1. Open **Messages** on the staff web app
2. Open a **Resident Care** conversation for a resident with a linked mobile account
3. Click 📞 (audio) or 📹 (video) in the top right
4. Resident receives an incoming call on their mobile app
5. Resident accepts → both sides connect via LiveKit

---

## Call States

```
ringing → active → ended
       → declined
       → canceled
       → timeout (60s)
       → failed
```

---

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/calls` | Start a call |
| POST | `/api/v1/calls/{id}/accept` | Accept (callee only) |
| POST | `/api/v1/calls/{id}/decline` | Decline (callee only) |
| POST | `/api/v1/calls/{id}/cancel` | Cancel (caller only, ringing) |
| POST | `/api/v1/calls/{id}/end` | End (either party, active) |
| GET  | `/api/v1/calls/{id}` | Get call status |
| GET  | `/api/v1/calls/{id}/events` | Audit log |

---

## WebSocket Events

| Event | Description |
|-------|-------------|
| `call.invite` | Sent to callee when a call is started |
| `call.accepted` | Sent to caller when callee accepts |
| `call.declined` | Sent to caller when callee declines |
| `call.canceled` | Sent to callee when caller cancels |
| `call.timeout` | Sent to both when invite expires (60s) |
| `call.ended` | Sent to both when call ends |

---

## LiveKit

Token minting is server-side only. Requires these in `.env`:

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
```

Install the Python package:

```bash
pip install livekit livekit-api
```

Caller token is minted at call creation. Callee token is minted on accept.

---

## Agent (Future Work)

`agent.py` is a LiveKit voice agent — not used in v1. Run separately when ready:

```bash
python agent.py dev
```

Requires `OPENAI_API_KEY` in `.env` and `pip install livekit-agents[openai]`.
