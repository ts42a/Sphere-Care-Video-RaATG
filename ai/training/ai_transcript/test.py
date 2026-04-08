# test.py - Webcam test for ASL static model (e.g. A, B, C...)
import argparse
import json
import time
import urllib.request
from pathlib import Path
from collections import deque, Counter
import cv2
import joblib
import numpy as np

try:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_tasks
    from mediapipe.tasks.python import vision
except ImportError:
    raise SystemExit("Run: py -m pip install mediapipe opencv-python numpy joblib")


ROOT = Path(__file__).resolve().parent
ARTIFACTS_DIR = ROOT / "artifacts" / "gesture"
MODEL_DIR = ROOT / "models"
MODEL_PATH = ARTIFACTS_DIR / "static_model.joblib"
LABELS_PATH = ARTIFACTS_DIR / "static_labels.json"
CALIBRATION_PATH = ARTIFACTS_DIR / "decoder_calibration.json"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)

DEFAULT_CONFIDENCE_THRESHOLD = 0.60
DEFAULT_HISTORY_SIZE = 8
DEFAULT_APPEND_COOLDOWN = 1.0
DEFAULT_STABLE_MIN_VOTES = 6


def _load_calibration_defaults() -> dict:
    if not CALIBRATION_PATH.exists():
        return {}
    with open(CALIBRATION_PATH, "r", encoding="utf-8") as f:
        try:
            payload = json.load(f)
        except json.JSONDecodeError:
            return {}
    return payload.get("static", {}) if isinstance(payload, dict) else {}

def get_hand_model_path() -> str:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    path = MODEL_DIR / "hand_landmarker.task"
    if not path.exists():
        print("Downloading MediaPipe hand_landmarker model...")
        urllib.request.urlretrieve(MODEL_URL, str(path))
        print("Done.")
    return str(path)

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
    pts = np.array([[lm.x, lm.y, lm.z] for lm in hand_landmarks], dtype=np.float32)

    # wrist-center
    pts -= pts[0:1, :]
    # scale-normalize using max 2D distance from wrist
    d = np.linalg.norm(pts[:, :2], axis=1)
    s = float(np.max(d)) if np.max(d) > 1e-6 else 1.0
    pts /= s
    return pts.reshape(-1).astype(np.float32)  # (63,)

def draw_text(img, lines, x=10, y=30, gap=30):
    for i, line in enumerate(lines):
        cv2.putText(
            img,
            line,
            (x, y + i * gap),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )

def majority_vote(items):
    if not items:
        return None
    return Counter(items).most_common(1)[0][0]

def main():
    cal = _load_calibration_defaults()
    parser = argparse.ArgumentParser(description="Realtime static ASL webcam test.")
    parser.add_argument(
        "--threshold", type=float, default=float(cal.get("confidence_threshold", DEFAULT_CONFIDENCE_THRESHOLD))
    )
    parser.add_argument("--history-size", type=int, default=int(cal.get("history_size", DEFAULT_HISTORY_SIZE)))
    parser.add_argument(
        "--append-cooldown",
        type=float,
        default=float(cal.get("append_cooldown_seconds", DEFAULT_APPEND_COOLDOWN)),
    )
    parser.add_argument(
        "--stable-min-votes", type=int, default=int(cal.get("stable_min_votes", DEFAULT_STABLE_MIN_VOTES))
    )
    args = parser.parse_args()
    if args.stable_min_votes > args.history_size:
        args.stable_min_votes = args.history_size

    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model not found: {MODEL_PATH}")
    if not LABELS_PATH.exists():
        raise FileNotFoundError(f"Labels file not found: {LABELS_PATH}")
    model = joblib.load(MODEL_PATH)
    with open(LABELS_PATH, "r", encoding="utf-8") as f:
        meta = json.load(f)
    labels = meta.get("labels", [])
    schema_version = str(meta.get("schema_version", "")).strip()
    task = str(meta.get("task", "")).strip()
    if not schema_version:
        print("[WARN] legacy labels metadata detected (no schema_version).")
        print("       Re-run training to regenerate labels metadata with schema_version=gesture_labels_v2.")
    elif schema_version != "gesture_labels_v2":
        raise RuntimeError("Labels metadata schema_version must be 'gesture_labels_v2'.")
    if task and task != "static":
        raise RuntimeError("Labels metadata task must be 'static'.")
    feature_dim = int(meta.get("feature_dim", 63))
    if feature_dim != 63:
        raise RuntimeError(f"Unsupported feature_dim in labels metadata: {feature_dim}")
    input_vector_dim = int(meta.get("input_vector_dim", feature_dim))
    if input_vector_dim != feature_dim:
        raise RuntimeError(
            f"Invalid input_vector_dim in labels metadata: {input_vector_dim}, expected {feature_dim}"
        )

    model_features = getattr(model, "n_features_in_", None)
    if model_features is not None and int(model_features) != input_vector_dim:
        raise RuntimeError(
            f"Model input dimension mismatch: model expects {model_features}, metadata says {input_vector_dim}"
        )

    print("Loaded labels:", labels)
    detector = create_detector(num_hands=1)
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Could not open webcam.")
    win = "ASL Test - Multi Class"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    pred_history = deque(maxlen=args.history_size)
    text_buffer = ""
    last_append_time = 0.0
    print("Press Q or ESC to quit. \nPress C to clear text buffer. \nPress SPACE to add current stable prediction manually. ")

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            frame = cv2.flip(frame, 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            rgb = np.ascontiguousarray(rgb)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            res = detector.detect(mp_image)
            current_pred = "NO_HAND"
            current_conf = 0.0

            if res.hand_landmarks:
                vec = extract_hand_features(res.hand_landmarks[0]).reshape(1, -1)
                pred = model.predict(vec)[0]
                if hasattr(model, "predict_proba"):
                    probs = model.predict_proba(vec)[0]
                    best_idx = int(np.argmax(probs))
                    current_conf = float(probs[best_idx])
                    if current_conf >= args.threshold:
                        current_pred = str(pred)
                    else:
                        current_pred = "UNKNOWN"
                else:
                    current_pred = str(pred)
                    current_conf = 1.0
            pred_history.append(current_pred)
            smoothed_pred = majority_vote(list(pred_history)) or "NO_HAND"
            now = time.time()

            # auto-append only if stable and not UNKNOWN
            if (
                smoothed_pred not in ("NO_HAND", "UNKNOWN")
                and (now - last_append_time) > args.append_cooldown
                and len(pred_history) == args.history_size
                and list(pred_history).count(smoothed_pred) >= args.stable_min_votes
            ):
                text_buffer += smoothed_pred
                last_append_time = now
            draw_text(frame, [
                f"Prediction: {smoothed_pred}",
                f"Confidence: {current_conf:.2f}",
                f"Text: {text_buffer if text_buffer else '(empty)'}",
                f"Labels: {', '.join(labels)}",
                "Keys: C clear, SPACE add, Q/ESC quit"
            ])
            cv2.imshow(win, frame)
            key = cv2.waitKey(1) & 0xFF
            if key in (27, ord("q")):
                break
            elif key == ord("c"):
                text_buffer = ""
            elif key == 32:
                if smoothed_pred not in ("NO_HAND", "UNKNOWN"):
                    text_buffer += smoothed_pred
                    last_append_time = time.time()

    finally:
        cap.release()
        cv2.destroyAllWindows()
        if hasattr(detector, "close"):
            detector.close()

if __name__ == "__main__":
    main()