# AI Summary

Sphere Care supports AI generated summaries in three places:

1. Call transcript summary
2. Recording console video summary
3. Resident care profile summary

All three use the same provider setting in `backend/.env`.

## AI provider configuration

```env
# none, openai, openai_compatible, or ollama
AI_LLM_PROVIDER=ollama

# OpenAI or OpenAI compatible endpoint
AI_OPENAI_BASE_URL=https://api.openai.com/v1
AI_OPENAI_API_KEY=
AI_OPENAI_MODEL=gpt-4o-mini

# Local Ollama endpoint
AI_OLLAMA_BASE_URL=http://localhost:11434
AI_OLLAMA_MODEL=llama3.2:3b
```

Provider behaviour:

| Provider | Behaviour |
| --- | --- |
| `none` | Call summaries still use deterministic transcript fallback for demo. Recording and resident AI summary endpoints require a real provider. |
| `openai` | Uses OpenAI Chat Completions. Requires `AI_OPENAI_API_KEY` and API billing quota. |
| `openai_compatible` | Uses an OpenAI compatible endpoint. Set `AI_OPENAI_BASE_URL` and `AI_OPENAI_API_KEY`. |
| `ollama` | Uses a local Ollama model through `http://localhost:11434`. No OpenAI key is required. |

## Local Ollama setup

Install Ollama, then pull a small model for demo:

```bash
ollama pull llama3.2:3b
ollama list
```

Use the same model name in `backend/.env`:

```env
AI_LLM_PROVIDER=ollama
AI_OLLAMA_BASE_URL=http://localhost:11434
AI_OLLAMA_MODEL=llama3.2:3b
```

Restart the backend after changing `.env`.

---

## Feature 1 - Call Transcript AI Summary

### Demo flow

When a call ends, the backend now handles the full summary flow:

```text
Call ends
-> backend reads accumulated transcript
-> backend generates staff_summary and patient_summary
-> backend stores both in calls.ai_summary as JSON
-> backend sends the patient-safe summary directly into the chat conversation
-> backend broadcasts call.summary_ready to both participants
-> frontend_client and frontend_staff refresh or react to the message
```

The mobile client does not call any LLM API and does not store any API key.

### Stored format

`calls.ai_summary` stores JSON text:

```json
{
  "staff_summary": "The staff-facing summary for handover.",
  "patient_summary": "The patient-friendly summary sent to chat.",
  "generated_at": "2026-06-02T00:52:07+10:00"
}
```

The patient summary is intentionally safer and less clinical because it is sent directly to the mobile client's chat during demo.

### Chat message format

The backend sends a system message from `SphereCare AI` with message type `call_summary`:

```text
📋 Audio Call AI Summary
Date: 01 Jun 2026 · Duration: 1m
Care team: Admin One
Patient: Client One

The patient mentioned having trouble sleeping and sometimes feeling dizzy. The doctor advised drinking more water and continuing medication as usual. Please confirm important care details with the care team.

This is an AI generated summary. Please confirm important care details with your care team.
```

### WebSocket event

`call.summary_ready` is broadcast after the summary is saved and sent to chat:

```json
{
  "type": "call.summary_ready",
  "call_id": 12,
  "state": "ended",
  "ai_summary": "Patient-friendly summary text...",
  "patient_summary": "Patient-friendly summary text...",
  "staff_summary": "Staff handover summary text...",
  "message_conversation_id": 9,
  "message_id": 123
}
```

### API retrieval

```http
GET /api/v1/calls/{call_id}
```

The response includes `transcript` and `ai_summary`.

### Fallback behaviour

If `AI_LLM_PROVIDER=none`, or the LLM call fails, call summary generation falls back to deterministic transcript based demo text. This keeps the demo flow working and prevents a failed LLM provider from blocking the call end workflow.

---

## Feature 2 - Recording Console Video Summary

Each server-side recording can generate an AI summary through:

```http
POST /api/v1/records/{record_id}/ai-summary
```

The endpoint reads `transcript_text` or falls back to the record `notes`, sends the text to the configured LLM provider, and writes the result to `records.ai_summary`.

Requirements:

- The recording must have `transcript_text` or non-empty `notes`.
- Local vault recordings are excluded because they do not have a server record ID.
- A real provider such as `openai` or `ollama` should be enabled for this feature.

---

## Feature 3 - Resident AI Summary

Resident profile summaries are generated through:

```http
POST /api/v1/residents/{resident_id}/ai-summary
```

The endpoint aggregates:

| Source | Fields used |
| --- | --- |
| Resident profile | `status`, `care_level`, `primary_diagnosis`, `mobility_status`, `age`, `room` |
| Last 10 records | `category`, `notes`, `created_at` |
| Last 10 alerts | `alert_type`, `message`, `created_at` |

The generated summary is written to `residents.ai_summary` and returned in the response.

---

# Transcript and ASR settings

The call summary quality depends on transcript quality. The backend ASR service includes demo-oriented improvements:

- Whisper default model changed to `small`
- Whisper language defaults to English
- Audio chunk length defaults to 4 seconds
- 0.5 second overlap is kept between chunks
- Duplicate captions from overlap are suppressed
- Numeric speaker IDs such as `[5]` or `[1000001]` are removed from accumulated transcript text
- Short noise captions are filtered before summary generation

Recommended settings for demo:

```env
WHISPER_MODEL_SIZE=small
WHISPER_LANGUAGE=en
ASR_CHUNK_SECONDS=4.0
ASR_OVERLAP_SECONDS=0.5
ASR_MIN_RMS=450
```

If `small` is too slow on the demo laptop, use:

```env
WHISPER_MODEL_SIZE=base
WHISPER_LANGUAGE=en
ASR_CHUNK_SECONDS=3.5
ASR_OVERLAP_SECONDS=0.5
ASR_MIN_RMS=450
```

For best transcript quality during testing:

- Use separate devices for staff and client
- Keep phone and laptop apart
- Use earphones on at least one side to reduce echo
- Speak in complete sentences
- Wait a few seconds before ending the call so the last ASR chunk can finish

---

# Database columns

| Table | Column | Type | Description |
| --- | --- | --- | --- |
| `calls` | `transcript` | `TEXT` | Raw accumulated ASR transcript used for call summary. |
| `calls` | `ai_summary` | `TEXT` | JSON text containing `staff_summary`, `patient_summary`, and `generated_at`. |
| `records` | `ai_summary` | `TEXT` | LLM generated recording summary. |
| `residents` | `ai_summary` | `TEXT` | LLM generated resident care summary. |

The `calls` columns are added automatically through `runtime_migrations.py` on server startup.

---

# Testing AI summary

1. Start Ollama or configure OpenAI.
2. Start the backend.
3. Start `frontend_staff` and `frontend_client`.
4. Login as staff and client.
5. Make an audio or video call.
6. Speak 4 to 6 complete sentences.
7. End the call.
8. Check the chat conversation for the `SphereCare AI` summary message.

A successful demo should show:

- A call summary message in the chat
- No raw JSON in the chat
- No numeric speaker IDs in the summary
- A patient-friendly summary visible to the mobile client
- A `call.summary_ready` event visible in the frontend logs or behaviour
