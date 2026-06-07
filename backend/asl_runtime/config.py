"""Paths and defaults for ASL runtime (read-only use of training artifacts)."""
from __future__ import annotations

import json
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TRAINING_ROOT = PROJECT_ROOT / "ai" / "training" / "ai_transcript"

_ASLLM = Path(os.getenv("ASLLM_ROOT", str(PROJECT_ROOT / "ai" / "models" / "ASLLM")))
ARTIFACTS_DIR = Path(os.getenv("AI_ARTIFACT_DIR", str(_ASLLM / "artifacts" / "gesture")))
_LEGACY = TRAINING_ROOT / "artifacts" / "gesture"
if not (ARTIFACTS_DIR / "static_model.joblib").exists() and (_LEGACY / "static_model.joblib").exists():
    ARTIFACTS_DIR = _LEGACY

STATIC_MODEL = ARTIFACTS_DIR / "static_model.joblib"
STATIC_LABELS = ARTIFACTS_DIR / "static_labels.json"
MOTION_MODEL = ARTIFACTS_DIR / "motion_model.pt"
MOTION_LABELS = ARTIFACTS_DIR / "motion_labels.json"
CALIBRATION = ARTIFACTS_DIR / "decoder_calibration.json"
MP_MODEL_DIR = Path(os.getenv("AI_MEDIAPIPE_DIR", str(_ASLLM / "runtime")))


def ensure_training_path() -> None:
    import sys

    p = str(TRAINING_ROOT)
    if p not in sys.path:
        sys.path.insert(0, p)


def load_calibration() -> dict:
    if CALIBRATION.exists():
        with open(CALIBRATION, encoding="utf-8") as f:
            return json.load(f)
    return {
        "static": {
            "confidence_threshold": 0.54,
            "history_size": 8,
            "stable_min_votes": 6,
            "append_cooldown_seconds": 1.0,
        },
        "motion": {
            "confidence_threshold": 0.60,
            "history_size": 6,
            "stable_min_votes": 4,
            "append_cooldown_seconds": 1.2,
            "min_segment_frames": 8,
        },
    }
