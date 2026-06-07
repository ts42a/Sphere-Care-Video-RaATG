# Test AI Modules

Run these from the **repo root** with the backend venv active (`pip install -r requirements.txt`). Each module has a `test.py` (or equivalent) you can run standalone before integrating with the full app.

| Module | Path | What it tests |
|--------|------|----------------|
| **SCVAM 2.1** | `ai/models/SCVAM2.1/` | Video safety pipeline — frame extract, detection, pose, risk flags, LLM summary |
| **ASLLM** | `ai/training/ai_transcript/` | Static letters (A–Z) and motion signs (HELLO, HELP, …) via webcam |
| **SRM** | `ai/models/SRM/` | Sentence refinement — rough sign/word tokens → readable English |

## SCVAM 2.1 — video safety analysis

Test videos are **not in git** (`.mp4` is gitignored). Copy any short care-room or CCTV clip into `ai/models/SCVAM2.1/` — for example a 30–60 s `.mp4` you record locally, or export a clip from your demo footage.

Then run:

```powershell
python ai/models/SCVAM2.1/test.py
python ai/models/SCVAM2.1/test.py --video test1.mp4 --steps all
```

Interactive prompts let you pick a video and how many pipeline steps to run. Output is written under `ai/models/SCVAM2.1/output/`. Enable SCVAM in the app via `SCVAM_ENABLED=true` in `docker/.env` or `backend/.env`.

## ASLLM — static & motion sign recognition

Verify setup, then run the live webcam tests:

```powershell
cd ai/training/ai_transcript
python verify_setup.py

# Static ASL letters (fingerspelling) — needs webcam
python test.py

# Motion signs (HELLO, HELP, WATER, …) — needs webcam
python test_motion.py
```

To train models first (optional):

```powershell
python run_pipeline.py --mode both
```

Artifacts: `ai/training/ai_transcript/artifacts/gesture/`. See [ai/training/ai_transcript/README.md](../ai/training/ai_transcript/README.md) for the full train → test → export pipeline.

## SRM — sentence refinement

Refines recognised sign/word tokens into clear sentences (used after ASLLM output):

```powershell
# One-shot text test
python ai/models/SRM/test.py --text "hello howareyou i fine"

# Interactive mode — type rough text, get refined output
python ai/models/SRM/test.py

# Motion stream mode — enter words one at a time, see live translation
python ai/models/SRM/test.py --stream
```

Requires checkpoint at `ai/models/SRM/data/Motion/checkpoints/best.pt` and vocab JSON. See [ai/models/SRM/README.md](../ai/models/SRM/README.md) for training and evaluation.
