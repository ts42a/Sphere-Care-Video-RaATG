# ASLLM Runtime Layout

This folder is the deployment-facing home for ASLLM translators and model assets.

- `static/statictranslator.py` – static translator entrypoint
- `motion/motiontranslator.py` – motion translator entrypoint
- `artifacts/gesture/` – model artifacts (`*.joblib`, `*.pt`, labels, calibration)
- `runtime/` – runtime assets (`hand_landmarker.task`)

Current translator entrypoints are thin wrappers around the existing
`ai/training/ai_transcript` implementations to preserve behavior while
keeping production paths under `ai/models/ASLLM`.
