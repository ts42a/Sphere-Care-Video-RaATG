# SCVAM2.1 — Vault recording analysis

SCVAM2.1 analyzes encrypted vault recordings queued after upload from the Recording Console.

## Folder layout (org 1 example)

```
databases/org_1/
  scvam_input/
    RAW/                              ← STEP 1: drop source video here
      perfect fall of old women.mp4
      _processed/                     ← moved here after intake (do not re-queue)
    jobs/
      raw_perfect_fall_of_old_women/  ← STEP 2: worker copies from RAW & runs pipeline
        manifest.json
        input.mp4
        work/                         ← intermediate frames/detections (removed after success)
  scvam_output/                       ← STEP 3: final deliverables per video name
    perfect_fall_of_old_women/
      metadata.json                   ← video name, duration, timestamps
      summary.txt                     ← plain-English SCVAM summary
      llm_summary.json
      events.json
      source.mp4
  vault_recordings/...                ← encrypted vault clips (separate from SCVAM test path)
```

**Flow:** `RAW` → `jobs` (processing) → `scvam_output` (results).

## How it fits together

1. Staff records with **AI on** (camera card) and vault unlocked.
2. Browser uploads encrypted `.enc` to `databases/org_*/vault_recordings/...` and plaintext staging to `databases/org_*/scvam_input/jobs/{record_id}/input.webm`.
3. API inserts a row in `scvam_jobs` with status `pending`.
4. **SCVAM worker** (separate process) runs the full 11-step pipeline and writes:
   - `records.ai_summary`
   - `{record_id}.scvam.enc` (encrypted JSON sidecar next to the clip)
   - Optional `flags` / `ai_insights`

## Run the worker (required)

**Must run from the repo root** (`Sphere-Care-Video-RaATG`), not from `ai/training/...` — otherwise you get `No module named 'backend'`.

```powershell
cd C:\Users\tonmo\.cursor\projects\Sphere-Care-Video-RaATG
.venv\Scripts\Activate.ps1
python -m backend.workers.scvam_worker
```

Or use the helper script (works from any directory):

```powershell
.\scripts\run_scvam_worker.ps1
```

**Auto-start (default):** When you start the API on port 8000 (`uvicorn`, `python app.py`, etc.), the SCVAM worker thread starts in the same process (`SCVAM_WORKER_AUTOSTART=true`). You do **not** need a second terminal unless you prefer a separate process.

```powershell
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Check `GET /health` — `scvam_worker_running` should be `true`.

**Separate worker process** (optional): set `SCVAM_WORKER_AUTOSTART=false` in `.env`, then run `.\scripts\run_scvam_worker.ps1` in another terminal. Do not run both auto-start and the script at once.

One-shot (process a single pending job if any):

```powershell
python -m backend.workers.scvam_worker --once
```

## Pipeline steps (full)

Defined in `test.py` → `PIPELINE_STEPS`:

1. preprocess — MP4 uses index-step sampling; `.webm` uses time-based sampling (OpenCV often reports bogus FPS).  
2. dectator  
3. reducer  
4. zoom_evidence  
5. zoom_evidence_dectator  
6. zoom_evidence_verify  
7. pose_detection — `.webm` pre-decodes frame windows (no seek).  
8. merge_frames  
9. temporal_grn — FeatureGate + BiGRU; rules-only until `--weights` (no random-init blend).  
10. risk_engine  
11. llm_explain  

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `SCVAM_ENABLED` | `true` | Master switch |
| `SCVAM_PACKAGE_DIR` | `ai/training/SCVAM2.1` | Pipeline scripts root |
| `VAULT_STORAGE_ROOT` | `databases` | Vault + staging root |
| `SCVAM_MIN_DURATION_SEC` | `1` | Skip clips shorter than this (seconds) |
| `SCVAM_MAX_ATTEMPTS` | `3` | Job retries |
| `SCVAM_STAGING_TTL_HOURS` | `24` | Stale staging cleanup |
| `SCVAM_WORKER_POLL_SEC` | `5` | Poll interval |
| `SCVAM_WORKER_AUTOSTART` | `true` | Start worker thread when API boots (port 8000) |

LLM step uses the same env vars as `ai/llm/client.py` (`AI_LLM_PROVIDER`, Ollama/OpenAI keys).

## Manual test checklist

1. Unlock vault on Recording Console.
2. Turn **AI on** on a local camera card (green).
3. Record with **AI on** (any length ≥ 1s), then stop.
4. Confirm `databases/org_*/scvam_input/jobs/rec_*/input.webm` exists.
5. Confirm `scvam_jobs` row is `pending` (DB or API `GET /api/v1/records/{id}/scvam-status`).
6. Worker runs automatically with the API (`/health` → `scvam_worker_running: true`), or run `python -m backend.workers.scvam_worker --once` manually.
7. Job becomes `done`; `records.scvam_status` is `ready`; `ai_summary` populated.
8. Confirm `{record_id}.scvam.enc` beside `{record_id}.enc`.
9. Playback tab shows **AI ready** badge and summary snippet.
10. Staging folder removed after success.

## Security notes

- `scvam_input/` holds **temporary plaintext**; never expose via HTTP.
- Staging is gitignored; only `.gitkeep` placeholders are tracked.
- `.scvam.enc` uses a server-derived AES-GCM key (org-scoped), separate from the client vault DEK.
