# AI Summary

Sphere Care includes AI-generated summaries for three contexts: call transcripts, recording console videos, and resident care profiles. All three use the same LLM backend and are controlled by a single provider setting in `.env`.

---

## Configuration

Add the following to your `.env` file (or `backend/.env`):

```env
# Set to "openai", "openai_compatible", or "ollama" to enable. Default is "none" (disabled).
AI_LLM_PROVIDER=openai

# OpenAI / OpenAI-compatible (e.g. Azure, Together, Groq)
AI_OPENAI_API_KEY=sk-...
AI_OPENAI_BASE_URL=https://api.openai.com/v1
AI_OPENAI_MODEL=gpt-4o-mini

# Ollama (local)
AI_OLLAMA_BASE_URL=http://localhost:11434
AI_OLLAMA_MODEL=llama3
```

When `AI_LLM_PROVIDER=none` (the default), all summary endpoints return `503 Service Unavailable` and no LLM calls are made.

---

## Feature 1 — Call Transcript Summary

### How it works

1. While a call is active, every ASR caption broadcast via `transcript_service.broadcast_caption` is silently accumulated in memory, keyed by `call_id`.
2. When the call ends (`POST /calls/{call_id}/end`), a background task reads the accumulated text, calls the LLM, and writes the result to `calls.ai_summary` in the database.
3. A `call.summary_ready` WebSocket event is broadcast to both participants so the frontend can react immediately.

### Retrieving the summary

```http
GET /api/v1/calls/{call_id}
```

Response includes:

```json
{
  "call_id": 12,
  "state": "ended",
  "ai_summary": "Staff discussed the resident's medication schedule and flagged a follow-up appointment with the GP for next Thursday. No safety concerns were raised during the call.",
  ...
}
```

### Notes

- The transcript accumulator is in-memory. If the server restarts mid-call the transcript is lost, but the call record and summary column remain intact for any summary that was already saved.
- Short calls (< 10 seconds of speech) typically produce no summary because the ASR worker has insufficient audio to transcribe.
- The raw transcript is also stored in `calls.transcript` for audit purposes.

---

## Feature 2 — Recording Console Video Summary

### How it works

Each recording in the recording console has a **✨ Generate AI Summary** button. Clicking it calls:

```http
POST /api/v1/records/{record_id}/ai-summary
```

The endpoint reads `transcript_text` (ASR output stored against the record) or falls back to the record's `notes` field, sends the text to the LLM, and writes the result to `records.ai_summary`.

### UI

- The button appears in the playback panel when a server-side recording is selected (local vault recordings are excluded because they have no server record ID).
- After generation, the summary appears in the playback subtitle bar (truncated to 120 characters) and the button label changes to **✨ Regenerate AI Summary**.

### Requirements

- The recording must have either a `transcript_text` or a non-empty `notes` field. If neither exists the endpoint returns `422 Unprocessable Entity` with the message `"No transcript or notes available to summarise"`.

---

## Feature 3 — Resident AI Summary

### How it works

On the resident profile panel, click **✨ Generate AI Summary** to call:

```http
POST /api/v1/residents/{resident_id}/ai-summary
```

The endpoint aggregates:

| Source | Fields used |
|--------|-------------|
| Resident profile | `status`, `care_level`, `primary_diagnosis`, `mobility_status`, `age`, `room` |
| Last 10 records | `category`, `notes`, `created_at` |
| Last 10 alerts | `alert_type`, `message`, `created_at` |

This context is sent to the LLM with a clinical prompt. The result is written to `residents.ai_summary` and returned in the response.

### UI

- The generated summary replaces the **AI Summary (Last 72h)** box in the resident profile panel.
- The cached value in the residents list is also updated, so re-opening the profile shows the new summary immediately without a page refresh.
- Clicking the button again regenerates the summary with the latest data.

### Example output

```
John has a stable care status at Level 3. Recent records indicate a physiotherapy session on 28 May and a routine medication review. One medium-severity fall alert was logged on 26 May; no further incidents since. Staff should monitor mobility during night shifts and confirm GP follow-up scheduled for next week.
```

---

## LLM Prompts

| Feature | System prompt summary |
|---------|----------------------|
| Call transcript | Summarise in 3-5 sentences: topics discussed, care concerns, follow-up actions. |
| Recording | Summarise in 3-5 sentences: care concerns, behavioural observations, follow-up actions. |
| Resident | 4-6 sentence holistic status: current care, recent activity, alert history. |

All prompts instruct the model not to invent facts beyond the provided input.

---

## Supported LLM Providers

| `AI_LLM_PROVIDER` | Description |
|-------------------|-------------|
| `none` | Disabled. All summary endpoints return 503. |
| `openai` | OpenAI API (`gpt-4o-mini` by default). Requires `AI_OPENAI_API_KEY`. |
| `openai_compatible` | Any OpenAI-compatible endpoint (Azure, Together, Groq, etc.). Set `AI_OPENAI_BASE_URL` and `AI_OPENAI_API_KEY`. |
| `ollama` | Local Ollama server. Set `AI_OLLAMA_BASE_URL` and `AI_OLLAMA_MODEL`. |

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/calls/{call_id}` | Returns call detail including `ai_summary` and `transcript`. |
| `POST` | `/api/v1/residents/{resident_id}/ai-summary` | Generate and persist resident AI summary. |
| `POST` | `/api/v1/records/{record_id}/ai-summary` | Generate and persist recording AI summary. |

### WebSocket event — `call.summary_ready`

Broadcast to both call participants when the post-call summary is ready:

```json
{
  "type": "call.summary_ready",
  "call_id": 12,
  "state": "ended",
  "ai_summary": "..."
}
```

---

## Database Columns

| Table | Column | Type | Description |
|-------|--------|------|-------------|
| `calls` | `transcript` | `TEXT` | Raw accumulated ASR transcript. |
| `calls` | `ai_summary` | `TEXT` | LLM-generated call summary. |
| `records` | `ai_summary` | `TEXT` | LLM-generated recording summary (pre-existing column). |
| `residents` | `ai_summary` | `TEXT` | LLM-generated resident care summary (pre-existing column). |

The `calls` columns are added automatically via `runtime_migrations.py` on server startup — no manual migration step is required.
