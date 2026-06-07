# Sphere Care — User Guide

Quick reference for staff and family users. For developer setup, see [RUN.md](RUN.md) and [mobile_run.md](mobile_run.md).

## Platforms

| App | Users | Main areas |
|-----|-------|------------|
| **Staff Web** (browser) | Admins, nurses, carers, clinicians | Dashboard, Recording, Records, Flags, Residents, Bookings, Messages |
| **Family Mobile** (iOS/Android) | Clients and family contacts | Home, Call, Booking, Task, Messages |

## Staff quick start

1. Open the Staff Web URL → **Login** or **Create Account** (Staff/Admin).
2. Sidebar → **Recording Console** → unlock vault if prompted → allow camera/mic → **Start Recording**.
3. Stop when finished; open **Records Library** to review the session and transcript.

## Family mobile quick start

1. Install the app → **Login** or complete registration.
2. **Booking** tab → pick appointment type, doctor, date/time → confirm.
3. **Call** tab → select contact → **Video** or **Audio**.
4. Use **Messages** for team chat and **Home** for care tasks.

## Linking a resident for calls

Before calls work, link the mobile account to a resident:

1. Client: **Settings → Account** → copy Account ID (e.g. `ACC-47291038`).
2. Admin: **Residents → Add New Resident** → enter the Account ID.
3. Client: **Settings → Account** → accept the invitation.

Seed demo residents without linked accounts cannot receive calls.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Login fails | Check email/password; use Forgot Password; confirm account is active. |
| Camera/mic blocked | Browser or device settings → allow permissions; close other apps using the camera. |
| Cannot record | Log in; unlock vault; grant permissions; try Chrome or Edge. |
| No transcript | Wait 1–2 minutes; refresh record detail; check ASR is configured. |
| Badges not updating | Refresh page; open Messages/Notifications; check internet (WebSocket). |
| Call won't connect | Stable Wi‑Fi; callee online and linked; retry after 30s. |
| Vault locked | **Vault Unlock** on Recording or Records; vault password is separate from login. |

## Related docs

- [Documentation index](README.md)
- [Video/audio calls](call.md)
- [AI summaries](ai_summary.md)
