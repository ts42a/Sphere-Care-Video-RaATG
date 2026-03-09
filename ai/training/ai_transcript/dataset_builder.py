# dataset_builder.py - ASL dataset builder using MediaPipe Tasks HandLandmarker.
import os
import json
import time
import urllib.request
import numpy as np
import cv2
from pathlib import Path
from datetime import datetime

try:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_tasks
    from mediapipe.tasks.python import vision
except ImportError:
    raise SystemExit("Run: python -m pip install mediapipe opencv-python numpy")

# ---------------- PATHS ----------------
ROOT = Path(__file__).resolve().parent  # folder containing this file
BASE_DIR = ROOT / "dataset"
RAW_STATIC_DIR = BASE_DIR / "raw" / "static"
RAW_MOTION_DIR = BASE_DIR / "raw" / "motion"
META_FILE = BASE_DIR / "metadata.jsonl"

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
SEQ_LENGTH = 10                 # capture 10 frames per sample
MOTION_CAPTURE_SECONDS = 8.0    # allow multiple sequences
MIN_SEQ_VALID_FRAMES = 8        # if fewer than 
# ---------- Helpers ----------
def get_hand_model_path() -> str:
    path = MODEL_DIR / "hand_landmarker.task"
    if not path.exists():
        print("Downloading MediaPipe hand_landmarker model...")
        urllib.request.urlretrieve(MODEL_URL, str(path))
        print("Done.")
    return str(path)

def sanitize_static_label(name: str) -> str:
    name = name.strip().upper()
    if len(name) == 1 and name.isalpha():
        return name
    raise ValueError("STATIC label must be a single letter A–Z.")

def sanitize_motion_label(name: str) -> str:
    # motion labels can be words or letters like J/Z
    name = name.strip().upper()
    if not name:
        raise ValueError("MOTION label cannot be empty.")
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
    cleaned = "".join(ch for ch in name if ch in allowed)
    if not cleaned:
        raise ValueError("Label became empty after cleaning. Use letters/numbers/_/- only.")
    return cleaned


def ensure_label_folder(base: Path, label: str) -> Path:
    folder = base / label
    folder.mkdir(parents=True, exist_ok=True)
    return folder

def write_meta(record: dict):
    with open(META_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

def draw_text(img, lines, x=10, y=30, gap=28):
    for i, line in enumerate(lines):
        cv2.putText(
            img, line, (x, y + i * gap),
            cv2.FONT_HERSHEY_SIMPLEX, 0.75, (255, 255, 255), 2, cv2.LINE_AA
        )


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

def pick_best_k_by_centroid(samples: list[np.ndarray], k: int) -> list[np.ndarray]:
    X = np.stack(samples, axis=0)
    centroid = X.mean(axis=0)
    d = np.linalg.norm(X - centroid, axis=1)
    idx = np.argsort(d)[:k]
    return [samples[i] for i in idx]


# ---------- STATIC capture ----------
def capture_static(label: str, save_mode: str = DEFAULT_STATIC_SAVE_MODE):
    """
    STATIC letters A–Z -> saves (63,) .npy files

    save_mode:
      - "best5": save 5 most consistent frames (less variance in recent window)
    """
    label = sanitize_static_label(label)
    folder = ensure_label_folder(RAW_STATIC_DIR, label)
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Webcam not opened. Try VideoCapture(1) if you have multiple cameras.")

    detector = create_detector(num_hands=1)
    win = f"STATIC CAPTURE: {label}"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)

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

    write_meta({
        "session_id": session_id,
        "type": "static",
        "label": label,
        "capture_seconds": STATIC_CAPTURE_SECONDS,
        "save_mode": save_mode,
        "stable_candidates": len(stable_samples),
        "saved_count": len(chosen),
        "timestamp": session_id,
        "notes": "wrist+scale normalized (63D) from MediaPipe Tasks HandLandmarker"
    })

    print(f"[OK] STATIC saved {len(chosen)} samples for '{label}' -> {folder}")
    print(f"     Metadata appended -> {META_FILE}")


# ---------- MOTION capture ----------
def capture_motion(label: str):
    """
    MOTION words or motion letters (e.g., J/Z) -> saves (T,63) .npz files.
    Captures multiple sequences of length SEQ_LENGTH within MOTION_CAPTURE_SECONDS.
    """
    label = sanitize_motion_label(label)
    folder = ensure_label_folder(RAW_MOTION_DIR, label)
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Webcam not opened. Try VideoCapture(1) if you have multiple cameras.")

    detector = create_detector(num_hands=1)
    win = f"MOTION CAPTURE: {label}"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)

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
    sequence = []
    saved = 0
    detected_frames = 0
    start = time.time()
    end = start + MOTION_CAPTURE_SECONDS

    while time.time() < end:
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb = np.ascontiguousarray(rgb)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        res = detector.detect(mp_image)

        if res.hand_landmarks:
            detected_frames += 1
            vec = extract_hand_features(res.hand_landmarks[0])
            sequence.append(vec)

        # enough frames collected, save a sequence
        if len(sequence) >= SEQ_LENGTH:
            seq = np.stack(sequence[:SEQ_LENGTH], axis=0) 
            sequence = sequence[SEQ_LENGTH:]               

            if seq.shape[0] >= MIN_SEQ_VALID_FRAMES:
                out = folder / f"{label}_{session_id}_{sample_id:04d}.npz"
                np.savez(str(out), seq=seq.astype(np.float32))
                saved += 1
                sample_id += 1

        draw_text(frame, [
            f"MOTION: {label}",
            f"Detected frames: {detected_frames}",
            f"Buffer: {len(sequence)}/{SEQ_LENGTH}",
            f"Saved sequences: {saved}",
            "ESC/Q cancel"
        ])
        cv2.imshow(win, frame)
        if (cv2.waitKey(1) & 0xFF) in (27, ord("q")):
            break

    cap.release()
    cv2.destroyAllWindows()
    if hasattr(detector, "close"):
        detector.close()
    if saved == 0:
        print("[WARN] No sequences saved. Keep hand visible + move slower.")
        return

    write_meta({
        "session_id": session_id,
        "type": "motion",
        "label": label,
        "seq_length": SEQ_LENGTH,
        "capture_seconds": MOTION_CAPTURE_SECONDS,
        "saved_count": saved,
        "timestamp": session_id,
        "notes": "wrist+scale normalized (T,63) from MediaPipe Tasks HandLandmarker"
    })

    print(f"[OK] MOTION saved {saved} sequences for '{label}' -> {folder}")
    print(f"     Metadata appended -> {META_FILE}")


def main():
    while True:
        print("\n=== DATASET BUILDER (ASL) ===")
        print("1) Capture STATIC letter A–Z (save best 5)")
        print("2) Capture MOTION label (words / J / Z / etc.)")
        print("3) Exit")

        c = input("Select: ").strip()
        if c == "1":
            lb = input("Letter (A–Z): ").strip()
            capture_static(lb, save_mode="best5")
        elif c == "2":
            lb = input("Motion label (e.g., HELP / WATER / J / Z): ").strip()
            capture_motion(lb)
        elif c == "3":
            break
        else:
            print("Invalid choice.")


if __name__ == "__main__":
    main()