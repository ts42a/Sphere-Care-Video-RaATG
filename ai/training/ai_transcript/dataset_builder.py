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
MOTION_CAPTURE_SECONDS = 8.0
MIN_SEQ_VALID_FRAMES = 8
MOTION_NUM_HANDS = 2
MOTION_PREBUFFER_FRAMES = 4
MOTION_IDLE_HISTORY = 48
MOTION_END_IDLE_FRAMES = 4
MOTION_START_ENERGY = 0.035
MOTION_KEEPALIVE_ENERGY = 0.012
MOTION_MAX_FRAMES_PER_SAMPLE = 24
MOTION_MIN_PEAK_ENERGY = 0.030
MOTION_MIN_MEAN_ENERGY = 0.008
MOTION_DUPLICATE_SIMILARITY = 0.985
MOTION_DUPLICATE_COMPARE_LIMIT = 24
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


def extract_motion_features(hand_landmarks_list) -> np.ndarray:
    """
    Returns (126,) float32 for motion by concatenating up to 2 hands.
    Hand slots are ordered left-to-right and missing hands are zero-padded.
    """
    ordered = sorted(hand_landmarks_list[:MOTION_NUM_HANDS], key=lambda hand: float(hand[0].x))
    slots = [extract_hand_features(hand_landmarks) for hand_landmarks in ordered]
    while len(slots) < MOTION_NUM_HANDS:
        slots.append(np.zeros(63, dtype=np.float32))
    return np.concatenate(slots, axis=0).astype(np.float32)


def motion_energy(current: np.ndarray, previous: np.ndarray | None) -> float:
    if previous is None:
        return 0.0
    return float(np.mean(np.abs(current - previous)))


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
        and peak_energy >= max(start_threshold * 0.85, MOTION_MIN_PEAK_ENERGY)
        and mean_delta >= MOTION_MIN_MEAN_ENERGY
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
    seq = seq.astype(np.float32)
    if seq.ndim == 2 and seq.shape[1] == 63:
        seq = np.concatenate([seq, np.zeros((seq.shape[0], 63), dtype=np.float32)], axis=1)
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


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom <= 1e-8:
        return 0.0
    return float(np.dot(a, b) / denom)


def max_duplicate_similarity(signature: np.ndarray, signatures: list[np.ndarray]) -> float:
    if not signatures:
        return 0.0
    return float(max(cosine_similarity(signature, other) for other in signatures))


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
        f"Peak/Mean energy: {qc.get('peak_energy', 0.0):.3f} / {qc.get('mean_energy', 0.0):.3f}",
        f"Mean delta: {qc.get('mean_delta', 0.0):.3f}",
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
    MOTION words or motion letters (e.g., J/Z) -> saves variable-length (T,126) .npz files.
    Uses simple motion segmentation with prebuffering to reduce transition-frame leakage.
    """
    label = sanitize_motion_label(label)
    folder = ensure_label_folder(RAW_MOTION_DIR, label)
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Webcam not opened. Try VideoCapture(0) or VideoCapture(1) if you have multiple cameras.")

    detector = create_detector(num_hands=MOTION_NUM_HANDS)
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
            print("[CANCELED]")
            return

    session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    sample_id = 0
    prebuffer: deque[np.ndarray] = deque(maxlen=MOTION_PREBUFFER_FRAMES)
    idle_energies: deque[float] = deque(maxlen=MOTION_IDLE_HISTORY)
    active_sequence: list[np.ndarray] = []
    active_energies: list[float] = []
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
    idle_streak = 0
    last_vec: np.ndarray | None = None
    stop_capture = False
    accepted_lengths: list[int] = []
    accepted_qc_scores: list[float] = []
    recent_signatures = load_recent_motion_signatures(folder)
    start = time.time()
    end = start + MOTION_CAPTURE_SECONDS

    def flush_active_sequence(*, reason: str) -> None:
        nonlocal active_sequence, active_energies, sample_id, saved, reviewed, discarded, retried
        nonlocal qc_failed, duplicate_warnings, in_motion, idle_streak, active_streak, stop_capture
        nonlocal accepted_lengths, accepted_qc_scores, recent_signatures
        if len(active_sequence) < MIN_SEQ_VALID_FRAMES:
            active_sequence = []
            active_energies = []
            in_motion = False
            idle_streak = 0
            active_streak = 0
            return
        current_start_threshold, current_keep_threshold = adaptive_motion_thresholds(idle_energies)
        capped_frames = active_sequence[:MOTION_MAX_FRAMES_PER_SAMPLE]
        capped_energies = active_energies[: len(capped_frames)]
        trimmed_frames, trim_info = trim_motion_sequence(
            capped_frames,
            capped_energies,
            keep_threshold=current_keep_threshold,
        )
        if len(trimmed_frames) < MIN_SEQ_VALID_FRAMES:
            trimmed_frames = capped_frames
            trim_info = {"trim_start": 0, "trim_end": 0}
        seq = np.stack(trimmed_frames, axis=0).astype(np.float32)
        trimmed_energies = capped_energies[trim_info["trim_start"] : len(capped_energies) - trim_info["trim_end"]]
        qc = motion_qc_summary(
            seq,
            raw_seq_len=len(capped_frames),
            energies=trimmed_energies,
            start_threshold=current_start_threshold,
            keep_threshold=current_keep_threshold,
            trim_info=trim_info,
        )
        signature = sequence_signature(seq)
        duplicate_similarity = max_duplicate_similarity(signature, recent_signatures)
        qc["duplicate_similarity"] = duplicate_similarity
        qc["duplicate_warning"] = bool(duplicate_similarity >= MOTION_DUPLICATE_SIMILARITY)
        if not qc["qc_passed"]:
            qc_failed += 1
        if qc["duplicate_warning"]:
            duplicate_warnings += 1
        reviewed += 1
        ok, preview_frame = cap.read()
        if ok:
            preview_frame = cv2.flip(preview_frame, 1)
        else:
            preview_frame = np.zeros((480, 640, 3), dtype=np.uint8)
        decision = review_motion_sample(win=win, frame=preview_frame, label=label, qc=qc)
        if decision == "save":
            out = folder / f"{label}_{session_id}_{sample_id:04d}.npz"
            np.savez(str(out), seq=seq)
            append_sample_manifest(
                {
                    "sample_path": str(out.relative_to(ROOT)).replace("\\", "/"),
                    "task": "motion",
                    "label": label,
                    "source": "custom_capture",
                    "domain": "custom",
                    "signer_id": signer_id,
                    "session_id": session_id,
                    "capture_reason": reason,
                    "raw_seq_len": int(qc["raw_seq_len"]),
                    "feature_dim": int(qc["feature_dim"]),
                    "num_hands": MOTION_NUM_HANDS,
                    "review_decision": decision,
                    "duplicate_similarity": float(duplicate_similarity),
                    "qc": qc,
                    "capture_context": session_context or {},
                },
                dataset_kind="custom",
            )
            saved += 1
            sample_id += 1
            accepted_lengths.append(int(qc["trimmed_seq_len"]))
            accepted_qc_scores.append(float(qc["qc_score"]))
            recent_signatures.append(signature)
            if len(recent_signatures) > MOTION_DUPLICATE_COMPARE_LIMIT:
                recent_signatures = recent_signatures[-MOTION_DUPLICATE_COMPARE_LIMIT:]
        elif decision == "retry":
            retried += 1
        elif decision == "discard":
            discarded += 1
        else:
            stop_capture = True
        active_sequence = []
        active_energies = []
        in_motion = False
        idle_streak = 0
        active_streak = 0

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
        draw_hand_landmarks(frame, getattr(res, "hand_landmarks", None))
        energy = 0.0
        active_now = False

        if res.hand_landmarks:
            detected_frames += 1
            vec = extract_motion_features(res.hand_landmarks)
            prebuffer.append(vec)
            energy = motion_energy(vec, last_vec)
            started_now = False
            if not in_motion and energy < current_start_threshold:
                idle_energies.append(energy)
            active_now = energy >= (current_keep_threshold if in_motion else current_start_threshold)
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
                started_now = True
            if in_motion and not started_now:
                active_sequence.append(vec)
                active_energies.append(energy)
                if len(active_sequence) >= MOTION_MAX_FRAMES_PER_SAMPLE:
                    flush_active_sequence(reason="max_frames")
                elif idle_streak >= MOTION_END_IDLE_FRAMES:
                    flush_active_sequence(reason="idle_timeout")
            last_vec = vec
        else:
            if in_motion:
                idle_streak += 1
                if idle_streak >= MOTION_END_IDLE_FRAMES:
                    flush_active_sequence(reason="hand_lost")
            active_streak = 0
            last_vec = None

        draw_text(frame, [
            f"MOTION: {label}",
            f"Detected frames: {detected_frames}",
            f"Energy: {energy:.3f}",
            f"Start/Keep: {current_start_threshold:.3f} / {current_keep_threshold:.3f}",
            f"In motion: {'YES' if in_motion else 'NO'}",
            f"Active buffer: {len(active_sequence)}",
            f"Saved/Retry/Drop: {saved}/{retried}/{discarded}",
            "ESC/Q cancel"
        ])
        cv2.imshow(win, frame)
        if (cv2.waitKey(1) & 0xFF) in (27, ord("q")):
            break
        if stop_capture:
            break

    cap.release()
    cv2.destroyAllWindows()
    if hasattr(detector, "close"):
        detector.close()
    if active_sequence and not stop_capture:
        flush_active_sequence(reason="capture_end")

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
        "avg_seq_len": float(np.mean(accepted_lengths)) if accepted_lengths else 0.0,
        "avg_qc_score": float(np.mean(accepted_qc_scores)) if accepted_qc_scores else 0.0,
        "num_hands": MOTION_NUM_HANDS,
        "segmentation": {
            "prebuffer_frames": MOTION_PREBUFFER_FRAMES,
            "idle_history": MOTION_IDLE_HISTORY,
            "end_idle_frames": MOTION_END_IDLE_FRAMES,
            "start_energy": MOTION_START_ENERGY,
            "keepalive_energy": MOTION_KEEPALIVE_ENERGY,
            "max_frames_per_sample": MOTION_MAX_FRAMES_PER_SAMPLE,
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
        "notes": "wrist+scale normalized variable-length (T,126) motion tensors with adaptive segmentation, review, and QC"
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