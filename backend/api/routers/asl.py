# backend/api/routers/asl.py
# Static:  SVM sklearn Pipeline  — static_model.joblib  — 63-dim input
# Motion:  GRU PyTorch           — motion_model.pt       — 147-dim x 10 frames
# Calibration from decoder_calibration.json

from __future__ import annotations

import base64
import asyncio
import io
import json
import os
import urllib.request
from collections import deque
from pathlib import Path
from typing import Optional

import numpy as np
import joblib
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel

from backend.api.deps import get_current_admin_id
from backend.services.motiontranslator_manager import motiontranslator_manager
from backend.services.statictranslator_manager import statictranslator_manager

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")
router = APIRouter(tags=["ASL"])

# ── Paths ─────────────────────────────────────────────────────────────────────
_ASLLM_ROOT = Path(os.getenv("ASLLM_ROOT", "ai/models/ASLLM"))
_ARTIFACT_DIR = Path(os.getenv("AI_ARTIFACT_DIR", str(_ASLLM_ROOT / "artifacts" / "gesture")))
_MEDIAPIPE_DIR = Path(os.getenv("AI_MEDIAPIPE_DIR", str(_ASLLM_ROOT / "runtime")))

_STATIC_MODEL_PATH  = _ARTIFACT_DIR / "static_model.joblib"
_STATIC_LABELS_PATH = _ARTIFACT_DIR / "static_labels.json"
_MOTION_MODEL_PATH  = _ARTIFACT_DIR / "motion_model.pt"
_MOTION_LABELS_PATH = _ARTIFACT_DIR / "motion_labels.json"
_CALIBRATION_PATH   = _ARTIFACT_DIR / "decoder_calibration.json"
_MEDIAPIPE_PATH     = _MEDIAPIPE_DIR / "hand_landmarker.task"
_MEDIAPIPE_URL      = os.getenv(
    "AI_MEDIAPIPE_HAND_MODEL_URL",
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
)

# Backward-compatible fallback to legacy training path.
_LEGACY_ARTIFACT_DIR = Path("ai/training/ai_transcript/artifacts/gesture")
if not _STATIC_MODEL_PATH.exists() and (_LEGACY_ARTIFACT_DIR / "static_model.joblib").exists():
    _ARTIFACT_DIR = _LEGACY_ARTIFACT_DIR
    _STATIC_MODEL_PATH = _ARTIFACT_DIR / "static_model.joblib"
    _STATIC_LABELS_PATH = _ARTIFACT_DIR / "static_labels.json"
    _MOTION_MODEL_PATH = _ARTIFACT_DIR / "motion_model.pt"
    _MOTION_LABELS_PATH = _ARTIFACT_DIR / "motion_labels.json"
    _CALIBRATION_PATH = _ARTIFACT_DIR / "decoder_calibration.json"

# ── Calibration (from decoder_calibration.json) ───────────────────────────────
def _load_calibration() -> dict:
    if _CALIBRATION_PATH.exists():
        with open(_CALIBRATION_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {
        "static": {"confidence_threshold": 0.70, "history_size": 8, "stable_min_votes": 6, "append_cooldown_seconds": 1.0},
        "motion": {"confidence_threshold": 0.76, "history_size": 6, "stable_min_votes": 4, "append_cooldown_seconds": 1.2},
    }

_CAL = _load_calibration()
_STATIC_CONF_THRESHOLD = _CAL["static"]["confidence_threshold"]
_MOTION_CONF_THRESHOLD = _CAL["motion"]["confidence_threshold"]

# ── GRU Model definition (matches motion_model.pt architecture) ───────────────
def _build_gru_model(feature_dim: int, hidden_dim: int, num_layers: int,
                     num_classes: int, dropout: float):
    try:
        import torch.nn as nn
        class GRUModel(nn.Module):
            def __init__(self):
                super().__init__()
                self.gru  = nn.GRU(feature_dim, hidden_dim, num_layers,
                                   batch_first=True, dropout=dropout if num_layers > 1 else 0.0)
                self.head = nn.Linear(hidden_dim, num_classes)
            def forward(self, x):
                _, h = self.gru(x)
                return self.head(h[-1])
        return GRUModel()
    except ImportError:
        raise RuntimeError("PyTorch not installed. Run: pip install torch")

# ── Lazy singletons ───────────────────────────────────────────────────────────
_hand_detector  = None
_static_model   = None
_static_labels: list[str] = []
_motion_model   = None
_motion_labels: list[str] = []
_motion_meta: dict = {}

def _ensure_mediapipe():
    if not _MEDIAPIPE_PATH.exists():
        _MEDIAPIPE_DIR.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(_MEDIAPIPE_URL, str(_MEDIAPIPE_PATH))

def _get_hand_detector():
    global _hand_detector
    if _hand_detector is not None:
        return _hand_detector
    import mediapipe as mp
    _ensure_mediapipe()
    options = mp.tasks.vision.HandLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(_MEDIAPIPE_PATH)),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_hands=2,
        min_hand_detection_confidence=0.35,
        min_tracking_confidence=0.35,
    )
    _hand_detector = mp.tasks.vision.HandLandmarker.create_from_options(options)
    return _hand_detector

def _get_static_model():
    global _static_model, _static_labels
    if _static_model is not None:
        return _static_model, _static_labels
    if not _STATIC_MODEL_PATH.exists():
        raise RuntimeError(f"Static model not found: {_STATIC_MODEL_PATH}")
    _static_model = joblib.load(_STATIC_MODEL_PATH)
    if _STATIC_LABELS_PATH.exists():
        with open(_STATIC_LABELS_PATH, encoding="utf-8") as f:
            _static_labels = json.load(f).get("labels", [])
    return _static_model, _static_labels

def _get_motion_model():
    global _motion_model, _motion_labels, _motion_meta
    if _motion_model is not None:
        return _motion_model, _motion_labels, _motion_meta
    if not _MOTION_MODEL_PATH.exists():
        raise RuntimeError(f"Motion model not found: {_MOTION_MODEL_PATH}")
    import torch
    ckpt = torch.load(str(_MOTION_MODEL_PATH), map_location="cpu", weights_only=False)
    _motion_meta = {
        "feature_dim": ckpt["feature_dim"],
        "seq_len":     ckpt["seq_len"],
        "hidden_dim":  ckpt["hidden_dim"],
        "num_layers":  ckpt["num_layers"],
        "dropout":     ckpt["dropout"],
        "num_classes": ckpt["num_classes"],
    }
    _motion_labels = ckpt["labels"]
    model = _build_gru_model(
        feature_dim=ckpt["feature_dim"],
        hidden_dim=ckpt["hidden_dim"],
        num_layers=ckpt["num_layers"],
        num_classes=ckpt["num_classes"],
        dropout=ckpt["dropout"],
    )
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    _motion_model = model
    return _motion_model, _motion_labels, _motion_meta

# ── Feature extraction ────────────────────────────────────────────────────────
def _extract_static_features(hand_landmarks) -> np.ndarray:
    """63-dim: wrist-centered, max-2D-scale normalized. Matches dataset_builder.py"""
    pts = np.array([[lm.x, lm.y, lm.z] for lm in hand_landmarks], dtype=np.float32)
    pts -= pts[0:1, :]
    d = np.linalg.norm(pts[:, :2], axis=1)
    s = float(np.max(d)) if np.max(d) > 1e-6 else 1.0
    pts /= s
    return pts.reshape(-1).astype(np.float32)   # (63,)

def _extract_motion_features(hand_landmarks) -> np.ndarray:
    """
    63-dim per frame (same as static).
    The 147-dim is assembled across the sequence in _classify_motion:
      pos(63) + velocity(63) + per_landmark_speed(21) = 147 per frame
    This function returns the base 63-dim normalised vector for one frame.
    """
    pts = np.array([[lm.x, lm.y, lm.z] for lm in hand_landmarks], dtype=np.float32)
    pts -= pts[0:1, :]
    d = np.linalg.norm(pts[:, :2], axis=1)
    s = float(np.max(d)) if np.max(d) > 1e-6 else 1.0
    pts /= s
    return pts.reshape(-1).astype(np.float32)  # (63,)

# ── Classifiers ───────────────────────────────────────────────────────────────
def _classify_static(hand_landmarks) -> tuple[str, float]:
    model, labels = _get_static_model()
    vec  = _extract_static_features(hand_landmarks).reshape(1, -1)
    pred = model.predict(vec)[0]
    conf = float(np.max(model.predict_proba(vec)[0])) if hasattr(model, "predict_proba") else 1.0
    return str(pred), conf

def _build_147_sequence(seq_63: np.ndarray) -> np.ndarray:
    """
    Convert (T, 63) position sequence → (T, 147) feature sequence.
    Layout per frame: pos(63) + velocity(63) + per_landmark_speed(21) = 147
    velocity[0] = zeros (no previous frame)
    """
    T = seq_63.shape[0]
    vel = np.zeros_like(seq_63)                         # (T, 63)
    if T > 1:
        vel[1:] = seq_63[1:] - seq_63[:-1]             # frame delta

    # per-landmark L2 speed: reshape vel to (T,21,3), compute norm per lm
    vel_3d = vel.reshape(T, 21, 3)
    speed  = np.linalg.norm(vel_3d, axis=2)             # (T, 21)

    seq_147 = np.concatenate([seq_63, vel, speed], axis=1)  # (T, 147)
    return seq_147.astype(np.float32)


def _classify_motion(seq_vecs: list[np.ndarray]) -> tuple[str, float]:
    """seq_vecs: list of (63,) vectors from _extract_motion_features"""
    import torch, torch.nn.functional as F
    model, labels, meta = _get_motion_model()
    seq_len = meta["seq_len"]
    T = len(seq_vecs)

    # Stack to (T, 63)
    seq_63 = np.stack(seq_vecs, axis=0).astype(np.float32)

    # Pad or truncate to seq_len
    if T < seq_len:
        pad = np.zeros((seq_len - T, 63), dtype=np.float32)
        seq_63 = np.vstack([seq_63, pad])
    else:
        seq_63 = seq_63[:seq_len]

    # Expand to (seq_len, 147)
    seq_147 = _build_147_sequence(seq_63)

    x = torch.tensor(seq_147).unsqueeze(0)             # (1, 10, 147)
    with torch.no_grad():
        logits = model(x)                               # (1, num_classes)
        probs  = F.softmax(logits, dim=-1)[0].numpy()
    idx   = int(np.argmax(probs))
    conf  = float(probs[idx])
    label = labels[idx] if idx < len(labels) else str(idx)
    return label, conf

# ── Schemas ───────────────────────────────────────────────────────────────────
class ASLDetectRequest(BaseModel):
    image_b64: str
    mode: str = "static"                              # "static" | "motion"
    motion_seq: Optional[list[list[float]]] = None   # previous (147,) frames

class ASLDetectResponse(BaseModel):
    letter: str
    confidence: float
    hand_detected: bool
    mode: str
    landmarks: Optional[list[list[float]]] = None
    current_frame_features: Optional[list[float]] = None  # (147,) for frontend to accumulate

class ASLStatusResponse(BaseModel):
    engine_name: str
    models: list[str]
    static_model_loaded: bool
    motion_model_loaded: bool
    mediapipe_loaded: bool
    static_labels: list[str]
    motion_labels: list[str]
    static_conf_threshold: float
    motion_conf_threshold: float

class StaticTranslatorControlResponse(BaseModel):
    running: bool
    detail: str

class StaticTranslatorStatusResponse(BaseModel):
    running: bool
    latest_event: dict
    event_seq: int = 0
    last_error: Optional[str] = None

# ── Routes ────────────────────────────────────────────────────────────────────
@router.get("/status", response_model=ASLStatusResponse)
def asl_status(token: str = Depends(oauth2_scheme)):
    try: _get_static_model(); sm = True; sl = _static_labels
    except: sm = False; sl = []
    try: _get_motion_model(); mm = True; ml = _motion_labels
    except: mm = False; ml = []
    return ASLStatusResponse(
        engine_name="ASLLM",
        models=["static", "motion"],
        static_model_loaded=sm, motion_model_loaded=mm,
        mediapipe_loaded=_MEDIAPIPE_PATH.exists(),
        static_labels=sl, motion_labels=ml,
        static_conf_threshold=_STATIC_CONF_THRESHOLD,
        motion_conf_threshold=_MOTION_CONF_THRESHOLD,
    )

@router.post("/statictranslator/start", response_model=StaticTranslatorControlResponse)
def statictranslator_start():
    motiontranslator_manager.stop()
    r = statictranslator_manager.start()
    if r.get("started"):
        return StaticTranslatorControlResponse(running=True, detail="Static translator started.")
    if r.get("running"):
        return StaticTranslatorControlResponse(running=True, detail="Static translator already running.")
    return StaticTranslatorControlResponse(running=False, detail=str(r.get("reason") or "Failed to start static translator."))


@router.post("/statictranslator/stop", response_model=StaticTranslatorControlResponse)
def statictranslator_stop():
    r = statictranslator_manager.stop()
    if r.get("stopped"):
        return StaticTranslatorControlResponse(running=False, detail="Static translator stopping.")
    return StaticTranslatorControlResponse(running=False, detail="Static translator not running.")


@router.post("/motiontranslator/start", response_model=StaticTranslatorControlResponse)
def motiontranslator_start():
    # Ensure static translator is not running concurrently.
    statictranslator_manager.stop()
    r = motiontranslator_manager.start()
    if r.get("started"):
        return StaticTranslatorControlResponse(running=True, detail="Motion translator started.")
    if r.get("running"):
        return StaticTranslatorControlResponse(running=True, detail="Motion translator already running.")
    return StaticTranslatorControlResponse(running=False, detail=str(r.get("reason") or "Failed to start motion translator."))


@router.post("/motiontranslator/stop", response_model=StaticTranslatorControlResponse)
def motiontranslator_stop():
    r = motiontranslator_manager.stop()
    if r.get("stopped"):
        return StaticTranslatorControlResponse(running=False, detail="Motion translator stopping.")
    return StaticTranslatorControlResponse(running=False, detail="Motion translator not running.")


@router.get("/statictranslator/status", response_model=StaticTranslatorStatusResponse)
def statictranslator_status():
    s = statictranslator_manager.status()
    return StaticTranslatorStatusResponse(
        running=bool(s.get("running")),
        latest_event=s.get("latest_event") or {"type": "idle"},
        event_seq=int(s.get("event_seq") or 0),
        last_error=s.get("last_error"),
    )


@router.get("/motiontranslator/status", response_model=StaticTranslatorStatusResponse)
def motiontranslator_status():
    s = motiontranslator_manager.status()
    return StaticTranslatorStatusResponse(
        running=bool(s.get("running")),
        latest_event=s.get("latest_event") or {"type": "idle"},
        event_seq=int(s.get("event_seq") or 0),
        last_error=s.get("last_error"),
    )


@router.websocket("/statictranslator/ws")
async def statictranslator_ws(websocket: WebSocket):
    await websocket.accept()
    last_seq = -1
    try:
        while True:
            data = await asyncio.to_thread(statictranslator_manager.wait_for_event, last_seq, 1.0)
            seq = int(data.get("event_seq") or 0)
            if seq == last_seq:
                continue
            last_seq = seq
            await websocket.send_json(
                {
                    "running": bool(data.get("running")),
                    "last_error": data.get("last_error"),
                    "event": data.get("latest_event") or {"type": "idle"},
                    "event_seq": seq,
                }
            )
    except WebSocketDisconnect:
        return


@router.websocket("/motiontranslator/ws")
async def motiontranslator_ws(websocket: WebSocket):
    await websocket.accept()
    last_seq = -1
    try:
        while True:
            data = await asyncio.to_thread(motiontranslator_manager.wait_for_event, last_seq, 1.0)
            seq = int(data.get("event_seq") or 0)
            if seq == last_seq:
                continue
            last_seq = seq
            await websocket.send_json(
                {
                    "running": bool(data.get("running")),
                    "last_error": data.get("last_error"),
                    "event": data.get("latest_event") or {"type": "idle"},
                    "event_seq": seq,
                }
            )
    except WebSocketDisconnect:
        return


@router.post("/detect", response_model=ASLDetectResponse)
async def detect_asl(body: ASLDetectRequest, token: str = Depends(oauth2_scheme)):
    """
    Layer 1 — receive base64 frame from staff video call
    Layer 2 — MediaPipe landmarks → SVM (static) or GRU (motion)
    Layer 3 — return prediction + landmarks + frame features to frontend
    """
    # Layer 1: decode image
    try:
        img_bytes = base64.b64decode(body.image_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image.")

    try:
        import cv2
        arr   = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None: raise ValueError
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    except Exception:
        try:
            from PIL import Image
            rgb = np.array(Image.open(io.BytesIO(img_bytes)).convert("RGB"))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Image decode error: {e}")

    # Layer 2a: MediaPipe hand detection
    try:
        import mediapipe as mp
        detector = _get_hand_detector()
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result   = detector.detect(mp_image)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"MediaPipe error: {e}")

    if not result.hand_landmarks:
        return ASLDetectResponse(letter="", confidence=0.0, hand_detected=False, mode=body.mode)

    hand_lm = result.hand_landmarks[0]
    lm_out  = [[lm.x, lm.y, lm.z] for lm in hand_lm]

    # Layer 2b: classify
    conf_threshold = _STATIC_CONF_THRESHOLD if body.mode == "static" else _MOTION_CONF_THRESHOLD

    try:
        if body.mode == "motion":
            # curr_feat is 63-dim; frontend accumulates these and sends back
            curr_feat = _extract_motion_features(hand_lm)   # (63,)
            prev_seqs = [np.array(f, dtype=np.float32) for f in (body.motion_seq or [])]
            full_seq  = prev_seqs + [curr_feat]
            letter, confidence = _classify_motion(full_seq)
            return ASLDetectResponse(
                letter=letter if confidence >= conf_threshold else "",
                confidence=round(confidence, 3),
                hand_detected=True, mode=body.mode,
                landmarks=lm_out,
                current_frame_features=curr_feat.tolist(),  # (63,) — frontend accumulates
            )
        else:
            letter, confidence = _classify_static(hand_lm)
            return ASLDetectResponse(
                letter=letter if confidence >= conf_threshold else "",
                confidence=round(confidence, 3),
                hand_detected=True, mode=body.mode,
                landmarks=lm_out,
            )
    except RuntimeError:
        return ASLDetectResponse(
            letter="", confidence=0.0,
            hand_detected=True, mode=body.mode, landmarks=lm_out,
        )
