# Notification & Badge System

Real-time notification badges and alert delivery for Sphere Care. Covers unread counts for **Messages**, **Alerts**, and **Flags** — displayed as live red badges in the sidebar, updated instantly via WebSocket and cleared when the user reads or resolves the relevant item.

---

## Table of Contents

- [Overview](#overview)
- [File Structure](#file-structure)
- [Backend](#backend)
  - [Unread Counts Endpoint](#unread-counts-endpoint)
  - [Notification Service](#notification-service)
  - [WebSocket Events](#websocket-events)
- [Frontend](#frontend)
  - [BadgeManager](#badgemanager)
  - [Sidebar Integration](#sidebar-integration)
  - [Page-Level Mark-Read](#page-level-mark-read)
- [Badge Rules](#badge-rules)
- [Data Flow](#data-flow)
- [Setup Checklist](#setup-checklist)

---

## Overview

```
New event (flag / alert / message / booking)
        ↓
notification_service.broadcast_badge_update(admin_id, db)
        ↓
WebSocket → { type: "badge_update", messages: 2, alerts: 1, flags: 3 }
        ↓
BadgeManager.handleWsMessage()
        ↓
Sidebar badges update instantly, no page reload
```

Three badge categories are tracked:

| Category | Source model | Unread condition |
|----------|-------------|-----------------|
| `messages` | `Conversation` | `unread_count > 0` |
| `alerts` | `Alert` | `is_read = False` |
| `flags` | `Flag` | `status IN ('new', 'escalated')` |

---

## File Structure

```
backend/
└── api/
    └── routes/
        └── notifications.py        ← add GET /unread-counts here
backend/
└── services/
    └── notification_service.py     ← add broadcast_badge_update() + notify_* functions

style/
├── css/
│   ├── badge.css                   ← badge pill styles + animations
│   └── notifications.css
└── js/
    ├── badge_manager.js            ← badge state, REST fetch, WS handler
    ├── notification.js             ← notifications page logic (updated)
    └── script.js                   ← defines API_BASE (existing, unchanged)

pages/
└── notifications.html              ← updated script load order
```

---

## Backend

### Unread Counts Endpoint

**File:** `backend/api/routes/notifications.py` (append to bottom)

```
GET /api/v1/notifications/unread-counts
Authorization: Bearer <token>
```

Response:
```json
{
  "messages": 3,
  "alerts":   1,
  "flags":    2,
  "total":    6
}
```

No new router registration needed — the function uses the existing `router` object in `notifications.py`, which is already mounted at `/notifications` in `__init__.py`.

---

### Notification Service

**File:** `backend/services/notification_service.py` (append to bottom)

New functions added:

| Function | When to call |
|----------|-------------|
| `broadcast_badge_update(admin_id, db)` | After any create/read/resolve action — recomputes all counts and pushes `badge_update` via WebSocket |
| `notify_flag_created(flag, admin_id, db)` | After a new flag is saved to DB |
| `notify_flag_resolved(flag_id, admin_id, db)` | After flag status → `resolved` or `false_alarm` |
| `notify_alert_created(alert, admin_id, db)` | Updated — now also pushes badge update |
| `notify_alert_read(admin_id, db)` | After `PATCH /alerts/{id}/read` or mark-all-read |
| `notify_message_read(admin_id, db)` | After a conversation is opened / messages marked read |

**Call sites:**

```python
# flags.py — create_flag()
import asyncio
asyncio.create_task(
    notification_service.notify_flag_created(flag, admin_id=flag.admin_id, db=db)
)

# flags.py — submit_review(), when action resolves the flag
if body.review_action in ('resolve', 'false_alarm'):
    asyncio.create_task(
        notification_service.notify_flag_resolved(flag.id, admin_id=flag.admin_id, db=db)
    )

# alerts.py — mark_alert_read() and mark_all_read()
await notification_service.notify_alert_read(admin_id=alert.admin_id, db=db)

# messages.py — after marking conversation as read
await notification_service.notify_message_read(admin_id=admin_id, db=db)
```

---

### WebSocket Events

All events are broadcast via the existing `ws_manager.broadcast(admin_id, payload)`.

#### `badge_update`
Sent after any unread count changes. `BadgeManager` handles this automatically.
```json
{
  "type":     "badge_update",
  "messages": 3,
  "alerts":   1,
  "flags":    2,
  "total":    6
}
```

#### `ai_alert`
Sent when a new AI alert or critical alert is created. Pushes a card into the Priority Alerts panel on the notifications page.
```json
{
  "type": "ai_alert",
  "alert": {
    "id": 42,
    "title": "Possible Fall Flagged",
    "description": "Mr Chen exhibited unsteady gait...",
    "alert_type": "critical"
  }
}
```

#### `flag_created` / `flag_resolved`
Sent by `notify_flag_created` and `notify_flag_resolved`. The flags page can use these to prepend/remove items without a full reload.
```json
{ "type": "flag_created", "flag_id": 7, "severity": "high", "status": "new" }
{ "type": "flag_resolved", "flag_id": 7 }
```

#### `booking_created` / `booking_updated` / `booking_deleted`
Handled by the existing `notification_service` functions. The notifications page renders these in the appointment list in real time.

---

## Frontend

### BadgeManager

**File:** `style/js/badge_manager.js`

A self-initialising singleton. Exposes three public methods:

```js
BadgeManager.refresh()
// Re-fetches /api/v1/notifications/unread-counts and updates all badges.
// Called automatically on load and every 60 seconds as a fallback.

BadgeManager.handleWsMessage(msg)
// Pass any incoming WebSocket message to this.
// It only acts on { type: "badge_update" } messages.

BadgeManager.markPageRead(key)
// Instantly zeros the badge for 'messages', 'alerts', or 'flags'.
// Then re-fetches from server after 1.5s to confirm.
```

`badge_manager.js` uses `API_BASE` directly (defined in `script.js` as `'/api/v1'`). Do **not** use `window.API_BASE` — it is a plain global variable, not a window property.

**Load order in every HTML page:**
```html
<script src="../style/js/script.js"></script>       <!-- defines API_BASE -->
<script src="../style/js/badge_manager.js"></script> <!-- must be before notification.js -->
<script src="../style/js/notification.js"></script>
<script src="/components/sidebar.js"></script>
```

---

### Sidebar Integration

Add `data-badge` attributes to the relevant nav links in `sidebar.js` / your sidebar HTML:

```html
<a href="messages.html"      data-badge="messages">Messages</a>
<a href="notifications.html" data-badge="alerts">Alerts</a>
<a href="flags.html"         data-badge="flags">Flags</a>
```

`BadgeManager` auto-injects `<span class="nav-badge">N</span>` inside each matching element and keeps it in sync. The element needs `position: relative` (already handled in `badge.css`).

---

### Page-Level Mark-Read

Call this in `DOMContentLoaded` on each page that "consumes" a badge category:

```js
// messages.html
document.addEventListener('DOMContentLoaded', () => {
  BadgeManager.markPageRead('messages');
});

// notifications.html / alerts.html
document.addEventListener('DOMContentLoaded', () => {
  BadgeManager.markPageRead('alerts');
});

// flags.html
document.addEventListener('DOMContentLoaded', () => {
  BadgeManager.markPageRead('flags');
});
```

This gives instant visual feedback (badge clears immediately), then re-fetches from the server after 1.5 seconds to confirm the true count.

---

## Badge Rules

| Category | Increments when | Clears when |
|----------|----------------|-------------|
| `messages` | New message arrives in any conversation | User opens the conversation page |
| `alerts` | New `Alert` row created (`is_read=False`) | User clicks "Mark as read" or opens alerts page |
| `flags` | New `Flag` created with status `new` or `escalated` | Flag moves to `resolved`, `false_alarm`, or `in_review` |

---

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                      BACKEND                            │
│                                                         │
│  create_flag()  ──►  notify_flag_created()              │
│  mark_read()    ──►  notify_alert_read()                │
│  open_convo()   ──►  notify_message_read()              │
│                          │                              │
│                          ▼                              │
│              broadcast_badge_update(admin_id, db)       │
│                          │                              │
│               recompute counts from DB                  │
│                          │                              │
│              ws_manager.broadcast(admin_id, {           │
│                type: "badge_update",                    │
│                messages: N, alerts: N, flags: N         │
│              })                                         │
└──────────────────────────┬──────────────────────────────┘
                           │  WebSocket
┌──────────────────────────▼──────────────────────────────┐
│                      FRONTEND                           │
│                                                         │
│  ws.onmessage  ──►  BadgeManager.handleWsMessage(msg)   │
│                          │                              │
│                     _updateDom()                        │
│                          │                              │
│         [data-badge="alerts"] .nav-badge → "2"          │
│         [data-badge="flags"]  .nav-badge → "5"          │
└─────────────────────────────────────────────────────────┘
```

---

## Setup Checklist

- [ ] Append `GET /unread-counts` function to `notifications.py`
- [ ] Append new functions to `notification_service.py`
- [ ] Add `asyncio.create_task(notify_flag_created(...))` in `flags.py`
- [ ] Add `await notify_alert_read(...)` in `alerts.py`
- [ ] Add `await notify_message_read(...)` in `messages.py`
- [ ] Place `badge_manager.js` at `style/js/badge_manager.js`
- [ ] Place `badge.css` at `style/css/badge.css`
- [ ] Add `data-badge="..."` attributes to sidebar nav links
- [ ] Add `<link>` for `badge.css` in all page `<head>` sections
- [ ] Load `badge_manager.js` before `notification.js` in all pages
- [ ] Call `BadgeManager.markPageRead(key)` on each relevant page load
