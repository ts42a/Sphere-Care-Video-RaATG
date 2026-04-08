# dataset_builder.py - ASL dataset builder using MediaPipe Tasks HandLandmarker.
import os
import time
import urllib.request
from collections import deque
import numpy as np
import cv2
from pathlib import Path
from datetime import datetime
from dataset_manifest import RAW_CUSTOM_DIR, append_capture_metadata, append_sample_manifest
from label_spec import (
    canonicalize_motion_label_relaxed,
    canonicalize_static_label,
    load_label_spec,
)

try:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_tasks
    from mediapipe.tasks.python import vision
except ImportError:
    raise SystemExit("Run: python -m pip install mediapipe opencv-python numpy")

# ---------------- PATHS ----------------
ROOT = Path(__file__).resolve().parent  # folder containing this file
BASE_DIR = ROOT / "dataset"
RAW_STATIC_DIR = RAW_CUSTOM_DIR / "static"
RAW_MOTION_DIR = RAW_CUSTOM_DIR / "motion"
MODEL_DIR = ROOT / "models"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
POSE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
)

RAW_STATIC_DIR.mkdir(parents=True, exist_ok=True)
RAW_MOTION_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR.mkdir(parents=True, exist_ok=True)
BASE_DIR.mkdir(parents=True, exist_ok=True)


# ---------------- CONFIG ----------------
COUNTDOWN_SECONDS = 3

# STATIC (letters)
STATIC_CAPTURE_SECONDS = 3.0
STABILITY_WINDOW = 6
STABLE_VAR_THRESHOLD = 1e-4
MIN_STABLE_FRAMES = 8
DEFAULT_STATIC_SAVE_MODE = "best5"  # "best5" or "all"

# MOTION (words / J / Z)
SEQ_LENGTH = 10
MOTION_CAPTURE_SECONDS = 16.0
MIN_SEQ_VALID_FRAMES = 8
MOTION_NUM_HANDS = 2
MOTION_POSE_LANDMARKS = [0, 11, 12, 13, 14, 15, 16]  # nose, shoulders, elbows, wrists
MOTION_PREBUFFER_FRAMES = 4
MOTION_IDLE_HISTORY = 48
MOTION_END_IDLE_FRAMES = 4
MOTION_START_ENERGY = 0.020
MOTION_KEEPALIVE_ENERGY = 0.008
MOTION_VISIBLE_START_STREAK = 2
MOTION_MAX_FRAMES_PER_SAMPLE = 24
MOTION_MIN_PEAK_ENERGY = 0.015
MOTION_MIN_MEAN_ENERGY = 0.006
MOTION_MIN_FRAME_DELTA = 0.0015
MOTION_START_WINDOW = 4
MOTION_START_WINDOW_DELTA = 0.010
MOTION_STOP_VAR_WINDOW = 6
MOTION_STOP_VAR_THRESHOLD = 0.00006
MOTION_LONG_MAX_FRAMES = 96
MOTION_BURST_END_IDLE_FRAMES = 12
MOTION_SAVE_PREROLL_FRAMES = 2
MOTION_DUPLICATE_SIMILARITY = 0.985
MOTION_DUPLICATE_COMPARE_LIMIT = 24
MOTION_BURST_TARGET_REPS = 4
MOTION_BURST_SAVE_TOP_K = 2
MOTION_REVIEW_KEYS = "S save / R retry / D discard / Q cancel"
SESSION_CONTEXT_FIELDS = [
    ("location", "Location"),
    ("camera_type", "Camera type"),
    ("lighting", "Lighting"),
    ("background", "Background"),
    ("dominant_hand", "Dominant hand"),
]
SESSION_CONTEXT_DEFAULTS = {
    "location": "indoor_room",
    "camera_type": "webcam",
    "lighting": "bright_even",
    "background": "plain_wall",
    "dominant_hand": "right",
    "notes": "none",
}
SESSION_CONTEXT_EXAMPLES = {
    "location": "bedroom / office / living_room",
    "camera_type": "canon_r50_usb / laptop_webcam / camlink_hdmi",
    "lighting": "bright_even / daylight_window / dim",
    "background": "plain_wall / curtain / cluttered_room",
    "dominant_hand": "right / left",
    "notes": "standing_1m_from_camera",
}
HAND_CONNECTIONS_FALLBACK = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
]
# ---------- Helpers ----------
def get_hand_model_path() -> str:
    path = MODEL_DIR / "hand_landmarker.task"
    if not path.exists():
        print("Downloading MediaPipe hand_landmarker model...")
        urllib.request.urlretrieve(MODEL_URL, str(path))
        print("Done.")
    return str(path)


def get_pose_model_path() -> str:
    path = MODEL_DIR / "pose_landmarker.task"
    if not path.exists():
        print("Downloading MediaPipe pose_landmarker model...")
        urllib.request.urlretrieve(POSE_MODEL_URL, str(path))
        print("Done.")
    return str(path)

def sanitize_static_label(name: str) -> str:
    return canonicalize_static_label(name, spec=load_label_spec())

def sanitize_motion_label(name: str) -> str:
    return canonicalize_motion_label_relaxed(name, spec=load_label_spec())


def ensure_label_folder(base: Path, label: str) -> Path:
    folder = base / label
    folder.mkdir(parents=True, exist_ok=True)
    return folder

def draw_text(img, lines, x=10, y=30, gap=28):
    for i, line in enumerate(lines):
        cv2.putText(
            img, line, (x, y + i * gap),
            cv2.FONT_HERSHEY_SIMPLEX, 0.75, (255, 255, 255), 2, cv2.LINE_AA
        )


def wait_for_enter_to_start(*, cap, win: str, title: str, hint: str) -> bool:
    while True:
        ok, frame = cap.read()
        if not ok:
            return False
        frame = cv2.flip(frame, 1)
        draw_text(frame, [title, hint, "Press ENTER to start", "ESC/Q cancel"])
        cv2.imshow(win, frame)
        key = cv2.waitKey(1) & 0xFF
        if key in (13, 10):
            return True
        if key in (27, ord("q")):
            return False


def create_detector(num_hands=1):
    model_path = get_hand_model_path()
    base_options = mp_tasks.BaseOptions(model_asset_path=model_path)
    options = vision.HandLandmarkerOptions(
        base_options=base_options,
        num_hands=num_hands,
        min_hand_detection_confidence=0.6,
        min_tracking_confidence=0.6,
    )
    return vision.HandLandmarker.create_from_options(options)


def create_pose_detector() -> vision.PoseLandmarker:
    model_path = get_pose_model_path()
    base_options = mp_tasks.BaseOptions(model_asset_path=model_path)
    options = vision.PoseLandmarkerOptions(
        base_options=base_options,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    return vision.PoseLandmarker.create_from_options(options)

def extract_hand_features(hand_landmarks) -> np.ndarray:
    """
    Returns (63,) float32:
    - wrist-centered
    - scale-normalized using max 2D distance from wrist
    """
    pts = np.array([[lm.x, lm.y, lm.z] for lm in hand_landmarks], dtype=np.float32)
    # wrist-center
    pts -= pts[0:1, :]
    # scale-normalize (2D)
    d = np.linalg.norm(pts[:, :2], axis=1)
    s = float(np.max(d)) if np.max(d) > 1e-6 else 1.0
    pts /= s

    return pts.reshape(-1).astype(np.float32)  # (63,)


def extract_motion_features(hand_landmarks_list, pose_landmarks=None) -> np.ndarray:
    """
    Returns (126 + pose_dims,) float32 for motion by concatenating up to 2 hands + pose context.
    Hand slots are ordered left-to-right and missing hands are zero-padded.
    """
    ordered = sorted(hand_landmarks_list[:MOTION_NUM_HANDS], key=lambda hand: float(hand[0].x))
    slots = [extract_hand_features(hand_landmarks) for hand_landmarks in ordered]
    while len(slots) < MOTION_NUM_HANDS:
        slots.append(np.zeros(63, dtype=np.float32))
    hand_vec = np.concatenate(slots, axis=0).astype(np.float32)
    pose_dim = len(MOTION_POSE_LANDMARKS) * 3
    pose_vec = np.zeros(pose_dim, dtype=np.float32)
    if pose_landmarks:
        pts = np.array([[lm.x, lm.y, lm.z] for lm in pose_landmarks], dtype=np.float32)
        if pts.shape[0] >= max(MOTION_POSE_LANDMARKS) + 1:
            chosen = pts[MOTION_POSE_LANDMARKS].copy()
            shoulders = pts[[11, 12], :2]
            center = shoulders.mean(axis=0)
            shoulder_dist = float(np.linalg.norm(shoulders[0] - shoulders[1]))
            scale = shoulder_dist if shoulder_dist > 1e-6 else 1.0
            chosen[:, :2] = (chosen[:, :2] - center) / scale
            pose_vec = chosen.reshape(-1).astype(np.float32)
    return np.concatenate([hand_vec, pose_vec], axis=0).astype(np.float32)


def align_motion_feature_dim(seq: np.ndarray, target_dim: int | None = None) -> np.ndarray:
    target_dim = int(target_dim or (126 + len(MOTION_POSE_LANDMARKS) * 3))
    if seq.ndim != 2:
        raise ValueError(f"Expected 2D motion tensor, got {seq.shape}")
    if seq.shape[1] == target_dim:
        return seq.astype(np.float32)
    if seq.shape[1] < target_dim:
        pad = np.zeros((seq.shape[0], target_dim - seq.shape[1]), dtype=np.float32)
        return np.concatenate([seq.astype(np.float32), pad], axis=1)
    return seq[:, :target_dim].astype(np.float32)


def motion_energy(current: np.ndarray, previous: np.ndarray | None) -> float:
    if previous is None:
        return 0.0
    return float(np.mean(np.abs(current - previous)))


def motion_window_delta(window: deque[np.ndarray]) -> float:
    if len(window) < 2:
        return 0.0
    arr = np.stack(list(window), axis=0).astype(np.float32)
    deltas = np.diff(arr, axis=0)
    return float(np.mean(np.linalg.norm(deltas, axis=1)))


def adaptive_motion_thresholds(idle_energies: deque[float]) -> tuple[float, float]:
    if len(idle_energies) < 6:
        return MOTION_START_ENERGY, MOTION_KEEPALIVE_ENERGY
    arr = np.array(idle_energies, dtype=np.float32)
    median = float(np.median(arr))
    mad = float(np.median(np.abs(arr - median)))
    noise = max(mad * 1.4826, 0.0025)
    start = max(MOTION_START_ENERGY, median + 3.0 * noise)
    keep = max(MOTION_KEEPALIVE_ENERGY, median + 1.8 * noise)
    if keep >= start:
        keep = max(MOTION_KEEPALIVE_ENERGY, start * 0.75)
    return float(start), float(keep)


def trim_motion_sequence(
    frames: list[np.ndarray],
    energies: list[float],
    *,
    keep_threshold: float,
) -> tuple[list[np.ndarray], dict]:
    if not frames:
        return [], {"trim_start": 0, "trim_end": 0}
    if len(frames) != len(energies):
        energies = [0.0] + energies[: max(len(frames) - 1, 0)]
        energies = (energies + [0.0] * len(frames))[: len(frames)]
    trim_floor = max(keep_threshold * 0.75, 0.006)
    start = 0
    end = len(frames)
    while start < max(end - MIN_SEQ_VALID_FRAMES, 0) and energies[start] < trim_floor:
        start += 1
    while end - start > MIN_SEQ_VALID_FRAMES and energies[end - 1] < trim_floor:
        end -= 1
    start = max(0, start - 1)
    end = min(len(frames), end + 1)
    return frames[start:end], {"trim_start": int(start), "trim_end": int(len(frames) - end)}


def suggest_motion_segments(
    frames: list[np.ndarray],
    energies: list[float],
    *,
    keep_threshold: float,
    preview_frames: list[np.ndarray] | None = None,
) -> list[dict]:
    if len(frames) < MIN_SEQ_VALID_FRAMES:
        return []
    seq = np.stack([align_motion_feature_dim(f.reshape(1, -1))[0] for f in frames], axis=0).astype(np.float32)
    if len(energies) != len(frames):
        energies = [0.0] + energies[: max(len(frames) - 1, 0)]
        energies = (energies + [0.0] * len(frames))[: len(frames)]
    active_floor = max(keep_threshold * 0.85, MOTION_MIN_FRAME_DELTA)
    segments: list[tuple[int, int]] = []
    start_idx: int | None = None
    gap = 0
    for idx, energy in enumerate(energies):
        is_active = energy >= active_floor
        if is_active:
            if start_idx is None:
                start_idx = max(0, idx - 1)
            gap = 0
        elif start_idx is not None:
            gap += 1
            if gap >= MOTION_END_IDLE_FRAMES:
                end_idx = max(start_idx + MIN_SEQ_VALID_FRAMES, idx - gap + 2)
                segments.append((start_idx, min(len(seq), end_idx)))
                start_idx = None
                gap = 0
    if start_idx is not None:
        segments.append((start_idx, len(seq)))
    if not segments:
        segments = [(0, len(seq))]

    candidates: list[dict] = []
    for seg_start, seg_end in segments:
        sub_frames = [f for f in frames[seg_start:seg_end]]
        sub_energies = energies[seg_start:seg_end]
        sub_preview_frames = list((preview_frames or [])[seg_start:seg_end]) if preview_frames else []
        trimmed_frames, trim_info = trim_motion_sequence(sub_frames, sub_energies, keep_threshold=keep_threshold)
        if len(trimmed_frames) < MIN_SEQ_VALID_FRAMES:
            continue
        sub_seq = np.stack([align_motion_feature_dim(f.reshape(1, -1))[0] for f in trimmed_frames], axis=0).astype(np.float32)
        trim_start = seg_start + int(trim_info.get("trim_start", 0))
        trim_end = max(0, len(seq) - (seg_start + len(trimmed_frames) + int(trim_info.get("trim_end", 0))))
        trim_meta = {"trim_start": trim_start, "trim_end": trim_end}
        kept_energies = sub_energies[trim_info.get("trim_start", 0): len(sub_energies) - trim_info.get("trim_end", 0)]
        kept_preview_frames = (
            sub_preview_frames[trim_info.get("trim_start", 0): len(sub_preview_frames) - trim_info.get("trim_end", 0)]
            if sub_preview_frames else []
        )
        candidates.append(
            {
                "seq": sub_seq,
                "energies": kept_energies,
                "preview_frames": kept_preview_frames,
                "trim_info": trim_meta,
                "span": [int(seg_start), int(seg_end)],
            }
        )
    return candidates


def motion_qc_summary(
    seq: np.ndarray,
    *,
    raw_seq_len: int,
    energies: list[float],
    start_threshold: float,
    keep_threshold: float,
    trim_info: dict,
) -> dict:
    if seq.size == 0:
        return {
            "raw_seq_len": int(raw_seq_len),
            "trimmed_seq_len": 0,
            "feature_dim": 0,
            "peak_energy": 0.0,
            "mean_energy": 0.0,
            "qc_passed": False,
        }
    left_norm = np.linalg.norm(seq[:, :63], axis=1)
    right_norm = np.linalg.norm(seq[:, 63:], axis=1)
    two_hand_frames = ((left_norm > 1e-6) & (right_norm > 1e-6)).sum()
    any_hand_frames = ((left_norm > 1e-6) | (right_norm > 1e-6)).sum()
    peak_energy = float(max(energies) if energies else 0.0)
    mean_energy = float(np.mean(energies)) if energies else 0.0
    mean_delta = float(np.mean(np.linalg.norm(np.diff(seq, axis=0), axis=1))) if len(seq) > 1 else 0.0
    qc_passed = bool(
        len(seq) >= MIN_SEQ_VALID_FRAMES
        and (
            mean_delta >= MOTION_MIN_MEAN_ENERGY
            or peak_energy >= max(start_threshold * 0.6, MOTION_MIN_PEAK_ENERGY)
        )
        and float(any_hand_frames / max(len(seq), 1)) >= 0.7
    )
    return {
        "raw_seq_len": int(raw_seq_len),
        "trimmed_seq_len": int(len(seq)),
        "feature_dim": int(seq.shape[1]),
        "peak_energy": peak_energy,
        "mean_energy": mean_energy,
        "mean_delta": mean_delta,
        "start_threshold": float(start_threshold),
        "keep_threshold": float(keep_threshold),
        "left_hand_ratio": float((left_norm > 1e-6).mean()),
        "right_hand_ratio": float((right_norm > 1e-6).mean()),
        "two_hand_ratio": float(two_hand_frames / max(len(seq), 1)),
        "hand_visible_ratio": float(any_hand_frames / max(len(seq), 1)),
        "trim_start_frames": int(trim_info.get("trim_start", 0)),
        "trim_end_frames": int(trim_info.get("trim_end", 0)),
        "qc_score": round(
            float(
                100.0
                * (
                    0.30 * min(len(seq) / max(SEQ_LENGTH, 1), 1.0)
                    + 0.30 * min(mean_delta / max(MOTION_MIN_MEAN_ENERGY * 2.0, 1e-6), 1.0)
                    + 0.25 * min(peak_energy / max(start_threshold * 1.25, 1e-6), 1.0)
                    + 0.15 * min(any_hand_frames / max(len(seq), 1), 1.0)
                )
            ),
            2,
        ),
        "qc_passed": qc_passed,
    }


def sequence_signature(seq: np.ndarray) -> np.ndarray:
    seq = align_motion_feature_dim(seq.astype(np.float32))
    deltas = np.diff(seq, axis=0) if len(seq) > 1 else np.zeros((1, seq.shape[1]), dtype=np.float32)
    return np.concatenate(
        [
            seq.mean(axis=0),
            seq.std(axis=0),
            seq[0],
            seq[-1],
            deltas.mean(axis=0),
            deltas.std(axis=0),
        ],
        axis=0,
    ).astype(np.float32)


def motion_vector_preview(seq: np.ndarray) -> str:
    if seq.size == 0 or len(seq) < 2:
        return "vector preview: n/a"
    deltas = np.diff(seq, axis=0)
    abs_mean = np.mean(np.abs(deltas), axis=0)
    top_idx = np.argsort(abs_mean)[-3:][::-1]
    top_vals = [f"d{int(i)}:{float(abs_mean[i]):.3f}" for i in top_idx]
    return "vector preview: " + ", ".join(top_vals)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    if a.shape != b.shape:
        n = min(a.shape[0], b.shape[0])
        if n <= 0:
            return 0.0
        a = a[:n]
        b = b[:n]
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom <= 1e-8:
        return 0.0
    return float(np.dot(a, b) / denom)


def max_duplicate_similarity(signature: np.ndarray, signatures: list[np.ndarray]) -> float:
    if not signatures:
        return 0.0
    return float(max(cosine_similarity(signature, other) for other in signatures))


def select_best_motion_candidates(candidates: list[dict], top_k: int) -> list[dict]:
    if not candidates:
        return []
    ranked = sorted(candidates, key=lambda c: float(c.get("qc", {}).get("qc_score", 0.0)), reverse=True)
    selected: list[dict] = []
    for cand in ranked:
        if len(selected) >= top_k:
            break
        signature = cand.get("signature")
        if signature is None:
            continue
        if any(cosine_similarity(signature, s.get("signature")) >= MOTION_DUPLICATE_SIMILARITY for s in selected):
            continue
        selected.append(cand)
    if len(selected) < top_k:
        selected = ranked[: min(top_k, len(ranked))]
    return selected


def load_recent_motion_signatures(folder: Path, limit: int = MOTION_DUPLICATE_COMPARE_LIMIT) -> list[np.ndarray]:
    files = sorted(folder.glob("*.npz"), key=lambda p: p.stat().st_mtime, reverse=True)[:limit]
    out: list[np.ndarray] = []
    for fp in files:
        try:
            data = np.load(fp)
            if "seq" not in data:
                continue
            seq = data["seq"].astype(np.float32)
            out.append(sequence_signature(seq))
        except Exception:
            continue
    return out


def prompt_session_context(previous: dict[str, str] | None = None) -> dict[str, str]:
    prev = previous or {}
    context: dict[str, str] = {}
    print("\nSession setup (press Enter to reuse previous value or default).")
    for key, label in SESSION_CONTEXT_FIELDS:
        fallback = SESSION_CONTEXT_DEFAULTS.get(key, "unknown")
        default = prev.get(key, "").strip() or fallback
        example = SESSION_CONTEXT_EXAMPLES.get(key, "")
        prompt = f"{label} [{default}] (e.g., {example}): "
        value = input(prompt).strip() or default
        context[key] = value
    notes_default = prev.get("notes", "").strip() or SESSION_CONTEXT_DEFAULTS["notes"]
    notes_example = SESSION_CONTEXT_EXAMPLES.get("notes", "")
    notes_prompt = f"Notes [{notes_default}] (e.g., {notes_example}): "
    context["notes"] = input(notes_prompt).strip() or notes_default
    return context


def draw_hand_landmarks(frame, hand_landmarks_list) -> None:
    if not hand_landmarks_list:
        return
    hand_connections = HAND_CONNECTIONS_FALLBACK
    try:
        solutions = getattr(mp, "solutions", None)
        if solutions is not None and hasattr(solutions, "hands"):
            hand_connections = list(solutions.hands.HAND_CONNECTIONS)
    except Exception:
        hand_connections = HAND_CONNECTIONS_FALLBACK
    h, w = frame.shape[:2]
    colors = [(0, 220, 0), (0, 180, 255)]
    for hand_idx, hand_landmarks in enumerate(hand_landmarks_list[:MOTION_NUM_HANDS]):
        color = colors[hand_idx % len(colors)]
        for a, b in hand_connections:
            ax = int(hand_landmarks[a].x * w)
            ay = int(hand_landmarks[a].y * h)
            bx = int(hand_landmarks[b].x * w)
            by = int(hand_landmarks[b].y * h)
            cv2.line(frame, (ax, ay), (bx, by), color, 2, cv2.LINE_AA)
        for lm in hand_landmarks:
            x = int(lm.x * w)
            y = int(lm.y * h)
            cv2.circle(frame, (x, y), 3, color, -1, cv2.LINE_AA)


def _draw_vec_hand(frame: np.ndarray, hand_vec: np.ndarray, origin: tuple[int, int], size: int, color: tuple[int, int, int]) -> None:
    if hand_vec.shape[0] != 63:
        return
    pts = hand_vec.reshape(21, 3)
    xy = pts[:, :2]
    norm = float(np.max(np.abs(xy))) if np.max(np.abs(xy)) > 1e-6 else 1.0
    xy = xy / norm
    ox, oy = origin
    scale = size * 0.42
    pix: list[tuple[int, int]] = []
    for p in xy:
        x = int(ox + p[0] * scale)
        y = int(oy + p[1] * scale)
        pix.append((x, y))
    for a, b in HAND_CONNECTIONS_FALLBACK:
        if 0 <= a < len(pix) and 0 <= b < len(pix):
            cv2.line(frame, pix[a], pix[b], color, 1, cv2.LINE_AA)
    for x, y in pix:
        cv2.circle(frame, (x, y), 2, color, -1, cv2.LINE_AA)


def _draw_pose_context(frame: np.ndarray, pose_vec: np.ndarray, origin: tuple[int, int], size: int) -> None:
    # pose_vec uses selected landmarks: nose, l/r shoulder, l/r elbow, l/r wrist => 7 x (x,y,z)
    if pose_vec.shape[0] != 21:
        return
    pts = pose_vec.reshape(7, 3)[:, :2]
    ox, oy = origin
    scale = size * 0.35
    pix: list[tuple[int, int]] = []
    for p in pts:
        x = int(ox + p[0] * scale)
        y = int(oy + p[1] * scale)
        pix.append((x, y))
    # indices: 0 nose, 1 l-shoulder, 2 r-shoulder, 3 l-elbow, 4 r-elbow, 5 l-wrist, 6 r-wrist
    edges = [(1, 2), (0, 1), (0, 2), (1, 3), (3, 5), (2, 4), (4, 6)]
    for a, b in edges:
        cv2.line(frame, pix[a], pix[b], (255, 255, 0), 1, cv2.LINE_AA)
    for i, (x, y) in enumerate(pix):
        r = 3 if i in (0, 1, 2) else 2
        cv2.circle(frame, (x, y), r, (255, 255, 0), -1, cv2.LINE_AA)


def draw_sequence_hand_preview(frame: np.ndarray, seq: np.ndarray, x: int, y: int, w: int, h: int) -> None:
    if seq.ndim != 2 or len(seq) == 0:
        return
    cv2.rectangle(frame, (x, y), (x + w, y + h), (100, 100, 100), 1, cv2.LINE_AA)
    slots = [0, len(seq) // 2, len(seq) - 1]
    labels = ["start", "mid", "end"]
    cell_w = w // 3
    center_y = y + h // 2 + 10
    for i, idx in enumerate(slots):
        idx = max(0, min(len(seq) - 1, idx))
        cx = x + i * cell_w + cell_w // 2
        cv2.putText(frame, labels[i], (x + i * cell_w + 6, y + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1, cv2.LINE_AA)
        vec = seq[idx]
        left = vec[:63]
        right = vec[63:126] if vec.shape[0] >= 126 else np.zeros(63, dtype=np.float32)
        pose = vec[126:147] if vec.shape[0] >= 147 else np.zeros(21, dtype=np.float32)
        _draw_vec_hand(frame, left, (cx - 28, center_y), min(cell_w, h), (0, 220, 0))
        if np.linalg.norm(right) > 1e-6:
            _draw_vec_hand(frame, right, (cx + 28, center_y), min(cell_w, h), (0, 180, 255))
        if np.linalg.norm(pose) > 1e-6:
            _draw_pose_context(frame, pose, (cx, center_y + 8), min(cell_w, h))


def draw_frame_strip_preview(frame: np.ndarray, preview_frames: list[np.ndarray], x: int, y: int, w: int, h: int) -> None:
    cv2.rectangle(frame, (x, y), (x + w, y + h), (100, 100, 100), 1, cv2.LINE_AA)
    if not preview_frames:
        cv2.putText(frame, "No frame preview", (x + 12, y + h // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (220, 220, 220), 1, cv2.LINE_AA)
        return
    slots = [0, min(1, len(preview_frames) - 1), len(preview_frames) // 2, len(preview_frames) - 1]
    labels = ["start1", "start2", "mid", "end"]
    cell_w = w // 4
    thumb_h = h - 28
    for i, idx in enumerate(slots):
        img = preview_frames[max(0, min(len(preview_frames) - 1, idx))]
        if img is None or img.size == 0:
            continue
        thumb = img.copy()
        if thumb.ndim != 3:
            continue
        th, tw = thumb.shape[:2]
        scale = min((cell_w - 12) / max(tw, 1), (thumb_h - 8) / max(th, 1))
        new_w = max(1, int(tw * scale))
        new_h = max(1, int(th * scale))
        thumb = cv2.resize(thumb, (new_w, new_h), interpolation=cv2.INTER_AREA)
        px = x + i * cell_w + (cell_w - new_w) // 2
        py = y + 22 + (thumb_h - new_h) // 2
        frame[py:py + new_h, px:px + new_w] = thumb
        cv2.putText(frame, labels[i], (x + i * cell_w + 6, y + 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1, cv2.LINE_AA)


def review_motion_sample(
    *,
    win: str,
    frame: np.ndarray,
    label: str,
    qc: dict,
) -> str:
    preview = frame.copy()
    duplicate_warning = bool(qc.get("duplicate_warning", False))
    recommendation = "SAVE" if qc.get("qc_passed") and not duplicate_warning else "RETRY"
    lines = [
        f"REVIEW: {label}",
        f"Recommendation: {recommendation}",
        f"Frames: {qc.get('trimmed_seq_len', 0)} (raw {qc.get('raw_seq_len', 0)})",
        f"Filtered low-move frames: {qc.get('filtered_frames', 0)}",
        f"Peak/Mean energy: {qc.get('peak_energy', 0.0):.3f} / {qc.get('mean_energy', 0.0):.3f}",
        f"Mean delta: {qc.get('mean_delta', 0.0):.3f}",
        f"{qc.get('motion_vector_preview', 'vector preview: n/a')}",
        f"QC score: {qc.get('qc_score', 0.0):.1f}",
        f"Two-hand ratio: {qc.get('two_hand_ratio', 0.0):.2f}",
        f"Near-duplicate sim: {qc.get('duplicate_similarity', 0.0):.3f}",
        f"Duplicate warning: {'YES' if duplicate_warning else 'NO'}",
        MOTION_REVIEW_KEYS,
    ]
    while True:
        canvas = preview.copy()
        draw_text(canvas, lines, x=10, y=30, gap=26)
        cv2.imshow(win, canvas)
        key = cv2.waitKey(0) & 0xFF
        if key == ord("s"):
            return "save"
        if key == ord("r"):
            return "retry"
        if key == ord("d"):
            return "discard"
        if key in (27, ord("q")):
            return "cancel"


def edit_motion_segment(
    *,
    win: str,
    label: str,
    seq: np.ndarray,
    qc: dict,
    preview_frames: list[np.ndarray] | None = None,
) -> tuple[str, np.ndarray, dict]:
    if seq.ndim != 2 or len(seq) < MIN_SEQ_VALID_FRAMES:
        return "skip", seq, {"trim_start": 0, "trim_end": 0}
    trim_start = 0
    trim_end = 0
    max_trim = max(len(seq) - MIN_SEQ_VALID_FRAMES, 0)
    plot_w, plot_h = 920, 620
    margin_l, margin_t = 40, 110
    plot_inner_w, plot_inner_h = 800, 260
    status = "Left/Right or A/D: start | [/] or J/L: end | T type trim | S save | X skip | Q cancel"
    while True:
        if trim_start < 0:
            trim_start = 0
        if trim_end < 0:
            trim_end = 0
        if trim_start + trim_end > max_trim:
            overflow = (trim_start + trim_end) - max_trim
            trim_end = max(0, trim_end - overflow)
        end_idx = max(trim_start + MIN_SEQ_VALID_FRAMES, len(seq) - trim_end)
        trimmed = seq[trim_start:end_idx]
        trimmed_preview_frames = list((preview_frames or [])[trim_start:end_idx]) if preview_frames else []
        energies = [motion_energy(trimmed[i], trimmed[i - 1]) for i in range(1, len(trimmed))]
        plot_vals = energies if energies else [0.0]
        vmax = max(max(plot_vals), 1e-6)
        canvas = np.zeros((plot_h, plot_w, 3), dtype=np.uint8)
        cv2.rectangle(
            canvas,
            (margin_l, margin_t),
            (margin_l + plot_inner_w, margin_t + plot_inner_h),
            (100, 100, 100),
            1,
            cv2.LINE_AA,
        )
        if len(plot_vals) > 1:
            pts = []
            for i, v in enumerate(plot_vals):
                x = margin_l + int(i * (plot_inner_w - 1) / max(len(plot_vals) - 1, 1))
                y = margin_t + plot_inner_h - int((v / vmax) * (plot_inner_h - 1))
                pts.append((x, y))
            cv2.polylines(canvas, [np.array(pts, dtype=np.int32)], False, (0, 220, 0), 2, cv2.LINE_AA)
        start_x = margin_l + int(trim_start * (plot_inner_w - 1) / max(len(seq) - 1, 1))
        end_x = margin_l + int((end_idx - 1) * (plot_inner_w - 1) / max(len(seq) - 1, 1))
        cv2.line(canvas, (start_x, margin_t), (start_x, margin_t + plot_inner_h), (255, 200, 0), 1, cv2.LINE_AA)
        cv2.line(canvas, (end_x, margin_t), (end_x, margin_t + plot_inner_h), (255, 200, 0), 1, cv2.LINE_AA)
        lines = [
            f"EDIT SEGMENT: {label}",
            f"Raw frames: {len(seq)} | Trimmed frames: {len(trimmed)}",
            f"Trim start/end: {trim_start}/{trim_end}",
            f"Max editable trim: {max_trim}",
            f"QC score (pre-edit): {qc.get('qc_score', 0.0):.1f}",
            "Reference photos: start1 / start2 / mid / end",
            status,
        ]
        draw_text(canvas, lines, x=10, y=28, gap=24)
        draw_frame_strip_preview(canvas, trimmed_preview_frames, x=50, y=390, w=820, h=200)
        cv2.imshow(win, canvas)
        key = cv2.waitKeyEx(0)
        key_low = key & 0xFF
        # Arrow keys on Windows/OpenCV: left=2424832 right=2555904.
        if key_low in (ord("a"), ord("A")) or key in (2424832,):
            trim_start = max(0, trim_start - 1)
        elif key_low in (ord("d"), ord("D")) or key in (2555904,):
            trim_start = min(max_trim, trim_start + 1)
        elif key_low in (ord("j"), ord("J"), ord("[")):
            trim_end = max(0, trim_end - 1)
        elif key_low in (ord("l"), ord("L"), ord("]")):
            trim_end = min(max_trim, trim_end + 1)
        elif key_low in (ord("t"), ord("T")):
            try:
                raw = input("Type trim_start,trim_end (example 2,1): ").strip()
                if raw:
                    left_s, right_s = [part.strip() for part in raw.split(",", 1)]
                    trim_start = max(0, min(max_trim, int(left_s or "0")))
                    trim_end = max(0, min(max_trim, int(right_s or "0")))
            except Exception:
                print("[WARN] Invalid trim input. Use format: start,end")
        elif key_low in (ord("s"), ord("S")):
            return "save", trimmed, {"trim_start": int(trim_start), "trim_end": int(trim_end)}
        elif key_low in (ord("x"), ord("X")):
            return "skip", trimmed, {"trim_start": int(trim_start), "trim_end": int(trim_end)}
        elif key_low in (27, ord("q"), ord("Q")):
            return "cancel", trimmed, {"trim_start": int(trim_start), "trim_end": int(trim_end)}


def pick_best_k_by_centroid(samples: list[np.ndarray], k: int) -> list[np.ndarray]:
    X = np.stack(samples, axis=0)
    centroid = X.mean(axis=0)
    d = np.linalg.norm(X - centroid, axis=1)
    idx = np.argsort(d)[:k]
    return [samples[i] for i in idx]


# ---------- STATIC capture ----------
def capture_static(
    label: str,
    save_mode: str = DEFAULT_STATIC_SAVE_MODE,
    *,
    signer_id: str = "unknown",
    session_context: dict[str, str] | None = None,
):
    """
    STATIC letters A–Z -> saves (63,) .npy files

    save_mode:
      - "best5": save 5 most consistent frames (less variance in recent window)
    """
    label = sanitize_static_label(label)
    folder = ensure_label_folder(RAW_STATIC_DIR, label)
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Webcam not opened. Try VideoCapture(0) or VideoCapture(1) if you have multiple cameras.")

    detector = create_detector(num_hands=1)
    win = f"STATIC CAPTURE: {label}"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)

    if not wait_for_enter_to_start(cap=cap, win=win, title=f"STATIC: {label}", hint="Hold your pose and get ready"):
        cap.release()
        cv2.destroyAllWindows()
        if hasattr(detector, "close"):
            detector.close()
        print("[CANCELED]")
        return

    # Countdown
    end_t = time.time() + COUNTDOWN_SECONDS
    while time.time() < end_t:
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)
        rem = int(np.ceil(end_t - time.time()))
        draw_text(frame, [f"STATIC: {label}", f"Starting in {rem}s", "Hold steady", "ESC/Q cancel"])
        cv2.imshow(win, frame)
        if (cv2.waitKey(1) & 0xFF) in (27, ord("q")):
            cap.release()
            cv2.destroyAllWindows()
            if hasattr(detector, "close"):
                detector.close()
            print("[CANCELED]")
            return

    recent = []
    stable_samples = []
    detected_frames = 0
    start = time.time()
    end = start + STATIC_CAPTURE_SECONDS

    while time.time() < end:
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb = np.ascontiguousarray(rgb)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        res = detector.detect(mp_image)

        stable = False
        if res.hand_landmarks:
            detected_frames += 1
            vec = extract_hand_features(res.hand_landmarks[0])

            recent.append(vec)
            if len(recent) > STABILITY_WINDOW:
                recent.pop(0)

            if len(recent) >= 3:
                var = np.var(np.stack(recent), axis=0).mean()
                stable = var < STABLE_VAR_THRESHOLD

            if stable:
                stable_samples.append(vec)
        else:
            recent.clear()

        draw_text(frame, [
            f"STATIC: {label}",
            f"Stable candidates: {len(stable_samples)}",
            f"Detected frames: {detected_frames}",
            f"Stable now: {'YES' if stable else 'NO'}",
            "ESC/Q cancel"
        ])
        cv2.imshow(win, frame)
        if (cv2.waitKey(1) & 0xFF) in (27, ord("q")):
            break

    cap.release()
    cv2.destroyAllWindows()
    if hasattr(detector, "close"):
        detector.close()
    if len(stable_samples) < MIN_STABLE_FRAMES:
        print("[WARN] Too few stable frames. Improve lighting + keep hand steady.")
        return
    if save_mode == "best5":
        chosen = pick_best_k_by_centroid(stable_samples, 5)
    else:
        chosen = stable_samples

    session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    for i, vec in enumerate(chosen, start=1):
        out = folder / f"{label}_{session_id}_{i:04d}.npy"
        np.save(str(out), vec)
        append_sample_manifest(
            {
                "sample_path": str(out.relative_to(ROOT)).replace("\\", "/"),
                "task": "static",
                "label": label,
                "source": "custom_capture",
                "domain": "custom",
                "signer_id": signer_id,
                "session_id": session_id,
                "capture_context": session_context or {},
            },
            dataset_kind="custom",
        )

    append_capture_metadata({
        "session_id": session_id,
        "type": "static",
        "label": label,
        "capture_seconds": STATIC_CAPTURE_SECONDS,
        "save_mode": save_mode,
        "stable_candidates": len(stable_samples),
        "saved_count": len(chosen),
        "timestamp": session_id,
        "signer_id": signer_id,
        "capture_context": session_context or {},
        "source": "custom_capture",
        "domain": "custom",
        "notes": "wrist+scale normalized (63D) from MediaPipe Tasks HandLandmarker"
    }, dataset_kind="custom")

    print(f"[OK] STATIC saved {len(chosen)} samples for '{label}' -> {folder}")
    print("     Metadata + sample manifest appended under dataset/")


# ---------- MOTION capture ----------
def capture_motion(
    label: str,
    *,
    signer_id: str = "unknown",
    session_context: dict[str, str] | None = None,
):
    """
    MOTION words or motion letters (e.g., J/Z) -> saves variable-length (T, hand+pose) .npz files.
    Uses simple motion segmentation with prebuffering to reduce transition-frame leakage.
    """
    label = sanitize_motion_label(label)
    folder = ensure_label_folder(RAW_MOTION_DIR, label)
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Webcam not opened. Try VideoCapture(0) or VideoCapture(1) if you have multiple cameras.")

    detector = create_detector(num_hands=MOTION_NUM_HANDS)
    pose_detector = create_pose_detector()
    win = f"MOTION CAPTURE: {label}"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)

    if not wait_for_enter_to_start(cap=cap, win=win, title=f"MOTION: {label}", hint="Get hands in frame and prepare gesture"):
        cap.release()
        cv2.destroyAllWindows()
        if hasattr(detector, "close"):
            detector.close()
        print("[CANCELED]")
        return

    # Countdown
    end_t = time.time() + COUNTDOWN_SECONDS
    while time.time() < end_t:
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)
        rem = int(np.ceil(end_t - time.time()))
        draw_text(frame, [f"MOTION: {label}", f"Starting in {rem}s", "Move naturally", "ESC/Q cancel"])
        cv2.imshow(win, frame)
        if (cv2.waitKey(1) & 0xFF) in (27, ord("q")):
            cap.release()
            cv2.destroyAllWindows()
            if hasattr(detector, "close"):
                detector.close()
            if hasattr(pose_detector, "close"):
                pose_detector.close()
            print("[CANCELED]")
            return

    session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    sample_id = 0
    prebuffer: deque[np.ndarray] = deque(maxlen=MOTION_PREBUFFER_FRAMES)
    prebuffer_preview_frames: deque[np.ndarray] = deque(maxlen=MOTION_PREBUFFER_FRAMES)
    start_window: deque[np.ndarray] = deque(maxlen=MOTION_START_WINDOW)
    idle_energies: deque[float] = deque(maxlen=MOTION_IDLE_HISTORY)
    active_sequence: list[np.ndarray] = []
    active_energies: list[float] = []
    active_preview_frames: list[np.ndarray] = []
    saved = 0
    reviewed = 0
    discarded = 0
    retried = 0
    qc_failed = 0
    duplicate_warnings = 0
    detected_frames = 0
    active_now = False
    in_motion = False
    active_streak = 0
    visible_streak = 0
    idle_streak = 0
    last_vec: np.ndarray | None = None
    stop_capture = False
    filtered_frames = 0
    low_var_window: deque[float] = deque(maxlen=MOTION_STOP_VAR_WINDOW)
    accepted_lengths: list[int] = []
    accepted_qc_scores: list[float] = []
    recent_signatures = load_recent_motion_signatures(folder)
    candidate_segments: list[dict] = []
    start = time.time()
    end = start + MOTION_CAPTURE_SECONDS

    def flush_active_sequence(*, reason: str) -> None:
        nonlocal active_sequence, active_energies, sample_id, saved, reviewed, discarded, retried
        nonlocal qc_failed, duplicate_warnings, in_motion, idle_streak, active_streak, visible_streak, stop_capture
        nonlocal accepted_lengths, accepted_qc_scores, recent_signatures, filtered_frames, low_var_window
        nonlocal candidate_segments, active_preview_frames
        if len(active_sequence) < MIN_SEQ_VALID_FRAMES:
            active_sequence = []
            active_energies = []
            active_preview_frames = []
            in_motion = False
            idle_streak = 0
            active_streak = 0
            low_var_window.clear()
            return
        current_start_threshold, current_keep_threshold = adaptive_motion_thresholds(idle_energies)
        long_frames = active_sequence[:MOTION_LONG_MAX_FRAMES]
        long_energies = active_energies[: len(long_frames)]
        long_preview_frames = active_preview_frames[: len(long_frames)]
        suggested = suggest_motion_segments(
            long_frames,
            long_energies,
            keep_threshold=current_keep_threshold,
            preview_frames=long_preview_frames,
        )
        if not suggested:
            discarded += 1
        for cand in suggested:
            seq = align_motion_feature_dim(cand["seq"])
            qc = motion_qc_summary(
                seq,
                raw_seq_len=len(long_frames),
                energies=list(cand.get("energies", [])),
                start_threshold=current_start_threshold,
                keep_threshold=current_keep_threshold,
                trim_info=dict(cand.get("trim_info", {})),
            )
            signature = sequence_signature(seq)
            duplicate_similarity = max_duplicate_similarity(signature, recent_signatures)
            qc["duplicate_similarity"] = duplicate_similarity
            qc["duplicate_warning"] = bool(duplicate_similarity >= MOTION_DUPLICATE_SIMILARITY)
            qc["filtered_frames"] = int(filtered_frames)
            qc["motion_vector_preview"] = motion_vector_preview(seq)
            qc["capture_reason"] = reason
            qc["source_span"] = list(cand.get("span", [0, len(seq)]))
            reviewed += 1
            if not qc["qc_passed"]:
                qc_failed += 1
                discarded += 1
                continue
            if qc["duplicate_warning"]:
                duplicate_warnings += 1
            candidate_segments.append(
                {
                    "seq": seq,
                    "qc": qc,
                    "signature": signature,
                    "capture_reason": reason,
                    "duplicate_similarity": float(duplicate_similarity),
                    "preview_frames": list(cand.get("preview_frames", [])),
                }
            )
        active_sequence = []
        active_energies = []
        active_preview_frames = []
        in_motion = False
        idle_streak = 0
        active_streak = 0
        visible_streak = 0
        filtered_frames = 0
        low_var_window.clear()

    while time.time() < end:
        current_start_threshold, current_keep_threshold = adaptive_motion_thresholds(idle_energies)
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb = np.ascontiguousarray(rgb)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        res = detector.detect(mp_image)
        pose_res = pose_detector.detect(mp_image)
        pose_lms = pose_res.pose_landmarks[0] if getattr(pose_res, "pose_landmarks", None) else None
        draw_hand_landmarks(frame, getattr(res, "hand_landmarks", None))
        energy = 0.0
        active_now = False

        if res.hand_landmarks:
            detected_frames += 1
            visible_streak += 1
            vec = extract_motion_features(res.hand_landmarks, pose_lms)
            prebuffer.append(vec)
            prebuffer_preview_frames.append(frame.copy())
            start_window.append(vec)
            energy = motion_energy(vec, last_vec)
            window_delta = motion_window_delta(start_window)
            started_now = False
            if not in_motion and energy < current_start_threshold:
                idle_energies.append(energy)
            active_now = energy >= (current_keep_threshold if in_motion else current_start_threshold)
            subtle_active = (not in_motion) and window_delta >= MOTION_START_WINDOW_DELTA
            visible_active = (not in_motion) and visible_streak >= MOTION_VISIBLE_START_STREAK
            active_now = active_now or subtle_active or visible_active
            if active_now:
                active_streak += 1
                idle_streak = 0
            else:
                active_streak = 0
                if in_motion:
                    idle_streak += 1
            if not in_motion and active_streak >= 2:
                in_motion = True
                active_sequence = list(prebuffer)
                active_energies = [0.0] * max(len(prebuffer) - 1, 0) + [energy]
                active_preview_frames = list(prebuffer_preview_frames)
                started_now = True
            if in_motion and not started_now:
                active_sequence.append(vec)
                active_energies.append(energy)
                active_preview_frames.append(frame.copy())
                if energy < MOTION_MIN_FRAME_DELTA:
                    filtered_frames += 1
                low_var_window.append(energy)
                if len(active_sequence) >= MOTION_LONG_MAX_FRAMES:
                    flush_active_sequence(reason="max_frames")
                elif idle_streak >= MOTION_BURST_END_IDLE_FRAMES:
                    flush_active_sequence(reason="idle_timeout")
            last_vec = vec
        else:
            visible_streak = 0
            if in_motion:
                idle_streak += 1
                if idle_streak >= MOTION_BURST_END_IDLE_FRAMES:
                    flush_active_sequence(reason="hand_lost")
            active_streak = 0
            last_vec = None

        draw_text(frame, [
            f"MOTION: {label}",
            f"Detected frames: {detected_frames}",
            f"Energy: {energy:.3f}",
            f"Window delta: {motion_window_delta(start_window):.3f}",
            f"Start/Keep: {current_start_threshold:.3f} / {current_keep_threshold:.3f}",
            f"Visible streak: {visible_streak}",
            f"In motion: {'YES' if in_motion else 'NO'}",
            f"Long tensor frames: {len(active_sequence)}",
            f"Filtered low-move: {filtered_frames}",
            f"Burst reps/target: {len(candidate_segments)}/{MOTION_BURST_TARGET_REPS}",
            f"Saved/Retry/Drop: {saved}/{retried}/{discarded}",
            "ESC/Q cancel"
        ])
        cv2.imshow(win, frame)
        if (cv2.waitKey(1) & 0xFF) in (27, ord("q")):
            break
        if stop_capture:
            break
        if len(candidate_segments) >= MOTION_BURST_TARGET_REPS:
            break

    if active_sequence and not stop_capture:
        flush_active_sequence(reason="capture_end")

    selected_segments = select_best_motion_candidates(candidate_segments, MOTION_BURST_SAVE_TOP_K)
    for seg in selected_segments:
        qc = dict(seg["qc"])
        action, edited_seq, edit_info = edit_motion_segment(
            win=win,
            label=label,
            seq=seg["seq"],
            qc=qc,
            preview_frames=list(seg.get("preview_frames", [])),
        )
        if action == "cancel":
            stop_capture = True
            break
        if action == "skip":
            discarded += 1
            continue
        original_seq = align_motion_feature_dim(seg["seq"].astype(np.float32))
        trim_start = int(edit_info.get("trim_start", 0))
        trim_end = int(edit_info.get("trim_end", 0))
        save_start = max(0, trim_start - MOTION_SAVE_PREROLL_FRAMES)
        save_end = max(save_start + MIN_SEQ_VALID_FRAMES, len(original_seq) - trim_end)
        edited_seq = align_motion_feature_dim(original_seq[save_start:save_end].astype(np.float32))
        if len(edited_seq) < MIN_SEQ_VALID_FRAMES:
            discarded += 1
            continue
        derived_energies = [motion_energy(edited_seq[i], edited_seq[i - 1]) for i in range(1, len(edited_seq))]
        qc_update = motion_qc_summary(
            edited_seq,
            raw_seq_len=int(qc.get("raw_seq_len", len(seg["seq"]))),
            energies=derived_energies,
            start_threshold=float(qc.get("start_threshold", MOTION_START_ENERGY)),
            keep_threshold=float(qc.get("keep_threshold", MOTION_KEEPALIVE_ENERGY)),
            trim_info={"trim_start": int(save_start), "trim_end": int(trim_end)},
        )
        qc_update["duplicate_similarity"] = float(seg.get("duplicate_similarity", 0.0))
        qc_update["duplicate_warning"] = bool(qc.get("duplicate_warning", False))
        qc_update["filtered_frames"] = int(qc.get("filtered_frames", 0))
        qc_update["motion_vector_preview"] = motion_vector_preview(edited_seq)
        qc_update["save_preroll_frames"] = int(trim_start - save_start)
        qc = qc_update
        out = folder / f"{label}_{session_id}_{sample_id:04d}.npz"
        np.savez(str(out), seq=edited_seq)
        append_sample_manifest(
            {
                "sample_path": str(out.relative_to(ROOT)).replace("\\", "/"),
                "task": "motion",
                "label": label,
                "source": "custom_capture",
                "domain": "custom",
                "signer_id": signer_id,
                "session_id": session_id,
                "capture_reason": str(seg.get("capture_reason", "burst_selected")),
                "raw_seq_len": int(qc["raw_seq_len"]),
                "feature_dim": int(qc["feature_dim"]),
                "num_hands": MOTION_NUM_HANDS,
                "review_decision": "manual_trim_save",
                "duplicate_similarity": float(seg.get("duplicate_similarity", 0.0)),
                "qc": qc,
                "capture_context": session_context or {},
            },
            dataset_kind="custom",
        )
        saved += 1
        sample_id += 1
        accepted_lengths.append(int(qc["trimmed_seq_len"]))
        accepted_qc_scores.append(float(qc["qc_score"]))
        recent_signatures.append(seg["signature"])
        if len(recent_signatures) > MOTION_DUPLICATE_COMPARE_LIMIT:
            recent_signatures = recent_signatures[-MOTION_DUPLICATE_COMPARE_LIMIT:]

    cap.release()
    cv2.destroyAllWindows()
    if hasattr(detector, "close"):
        detector.close()
    if hasattr(pose_detector, "close"):
        pose_detector.close()

    append_capture_metadata({
        "session_id": session_id,
        "type": "motion",
        "label": label,
        "seq_length": SEQ_LENGTH,
        "capture_seconds": MOTION_CAPTURE_SECONDS,
        "saved_count": saved,
        "reviewed_count": reviewed,
        "discarded_count": discarded,
        "retry_count": retried,
        "qc_failed_count": qc_failed,
        "duplicate_warning_count": duplicate_warnings,
        "burst_target_reps": MOTION_BURST_TARGET_REPS,
        "burst_candidates_count": len(candidate_segments),
        "burst_selected_count": len(selected_segments),
        "avg_seq_len": float(np.mean(accepted_lengths)) if accepted_lengths else 0.0,
        "avg_qc_score": float(np.mean(accepted_qc_scores)) if accepted_qc_scores else 0.0,
        "num_hands": MOTION_NUM_HANDS,
        "segmentation": {
            "prebuffer_frames": MOTION_PREBUFFER_FRAMES,
            "idle_history": MOTION_IDLE_HISTORY,
            "end_idle_frames": MOTION_END_IDLE_FRAMES,
            "burst_end_idle_frames": MOTION_BURST_END_IDLE_FRAMES,
            "start_energy": MOTION_START_ENERGY,
            "keepalive_energy": MOTION_KEEPALIVE_ENERGY,
            "max_frames_per_sample": MOTION_MAX_FRAMES_PER_SAMPLE,
            "max_long_frames": MOTION_LONG_MAX_FRAMES,
            "save_preroll_frames": MOTION_SAVE_PREROLL_FRAMES,
            "min_peak_energy": MOTION_MIN_PEAK_ENERGY,
            "min_mean_energy": MOTION_MIN_MEAN_ENERGY,
        },
        "adaptive_threshold_snapshot": {
            "observed_idle_mean": float(np.mean(idle_energies)) if idle_energies else 0.0,
            "observed_idle_max": float(np.max(idle_energies)) if idle_energies else 0.0,
            "final_start_threshold": float(adaptive_motion_thresholds(idle_energies)[0]),
            "final_keep_threshold": float(adaptive_motion_thresholds(idle_energies)[1]),
        },
        "timestamp": session_id,
        "signer_id": signer_id,
        "capture_context": session_context or {},
        "source": "custom_capture",
        "domain": "custom",
        "notes": "wrist+scale normalized variable-length motion tensors (hands+pose) with adaptive segmentation, review, and QC"
    }, dataset_kind="custom")

    if saved == 0:
        print("[WARN] No sequences saved. Keep hand visible + move slower.")
        return

    print("\nSession summary:")
    print(f" - Saved: {saved}")
    print(f" - Discarded: {discarded}")
    print(f" - Retried: {retried}")
    print(f" - Avg seq len: {np.mean(accepted_lengths):.2f}" if accepted_lengths else " - Avg seq len: 0.00")
    print(f" - Avg QC score: {np.mean(accepted_qc_scores):.2f}" if accepted_qc_scores else " - Avg QC score: 0.00")
    print(f"[OK] MOTION saved {saved} sequences for '{label}' -> {folder}")
    print("     Metadata + sample manifest appended under dataset/")


def main():
    spec = load_label_spec()
    last_session_context: dict[str, str] = {}
    print(
        f"Loaded label spec: {spec.version} | static={len(spec.static_labels)} "
        f"| motion={len(spec.motion_labels)}"
    )
    while True:
        print("\n=== DATASET BUILDER (ASL) ===")
        print("1) Capture STATIC letter A–Z (save best 5)")
        print("2) Capture MOTION label (words / J / Z / etc.)")
        print("3) Exit")

        c = input("Select: ").strip()
        if c == "1":
            lb = input("Letter (A–Z): ").strip()
            signer = input("Signer ID (e.g., p01): ").strip() or "unknown"
            reuse = "n"
            if last_session_context:
                reuse = input("Reuse previous session setup? [Y/n]: ").strip().lower() or "y"
            if not last_session_context or reuse not in ("y", "yes", ""):
                last_session_context = prompt_session_context(last_session_context)
            capture_static(
                lb,
                save_mode="best5",
                signer_id=signer,
                session_context=last_session_context,
            )
        elif c == "2":
            lb = input("Motion label (e.g., HELP / WATER / J / Z): ").strip()
            signer = input("Signer ID (e.g., p01): ").strip() or "unknown"
            reuse = "n"
            if last_session_context:
                reuse = input("Reuse previous session setup? [Y/n]: ").strip().lower() or "y"
            if not last_session_context or reuse not in ("y", "yes", ""):
                last_session_context = prompt_session_context(last_session_context)
            capture_motion(
                lb,
                signer_id=signer,
                session_context=last_session_context,
            )
        elif c == "3":
            break
        else:
            print("Invalid choice.")


if __name__ == "__main__":
    main()