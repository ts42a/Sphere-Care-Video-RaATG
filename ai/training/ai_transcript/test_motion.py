# test_motion.py - Webcam test for motion-word ASL model . Example labels: YES, NO, HELLO
import argparse
import json
import time
import urllib.request
from collections import deque, Counter
from pathlib import Path

import cv2
import numpy as np
from dataset_builder import (
    MOTION_END_IDLE_FRAMES,
    MOTION_KEEPALIVE_ENERGY,
    MOTION_MAX_FRAMES_PER_SAMPLE,
    MOTION_NUM_HANDS,
    MOTION_PREBUFFER_FRAMES,
    MOTION_START_ENERGY,
    create_pose_detector,
    extract_motion_features,
    motion_energy,
)
from motion_gru import load_motion_gru_checkpoint, predict_sequence_probs

try:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_tasks
    from mediapipe.tasks.python import vision
except ImportError:
    raise SystemExit("Run: py -m pip install mediapipe opencv-python numpy torch")


ROOT = Path(__file__).resolve().parent
ARTIFACTS_DIR = ROOT / "artifacts" / "gesture"
MODEL_DIR = ROOT / "models"
MODEL_PATH = ARTIFACTS_DIR / "motion_model.pt"
LABELS_PATH = ARTIFACTS_DIR / "motion_labels.json"
CALIBRATION_PATH = ARTIFACTS_DIR / "decoder_calibration.json"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)

DEFAULT_SEQ_LEN = 10
DEFAULT_PRED_HISTORY_SIZE = 6
DEFAULT_CONFIDENCE_THRESHOLD = 0.60
DEFAULT_APPEND_COOLDOWN = 1.2
DEFAULT_STABLE_MIN_VOTES = 4


def _load_calibration_defaults() -> dict:
    if not CALIBRATION_PATH.exists():
        return {}
    with open(CALIBRATION_PATH, "r", encoding="utf-8") as f:
        try:
            payload = json.load(f)
        except json.JSONDecodeError:
            return {}
    return payload.get("motion", {}) if isinstance(payload, dict) else {}

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
    parser = argparse.ArgumentParser(description="Realtime motion ASL webcam test.")
    parser.add_argument(
        "--threshold", type=float, default=float(cal.get("confidence_threshold", DEFAULT_CONFIDENCE_THRESHOLD))
    )
    parser.add_argument(
        "--history-size", type=int, default=int(cal.get("history_size", DEFAULT_PRED_HISTORY_SIZE))
    )
    parser.add_argument(
        "--append-cooldown",
        type=float,
        default=float(cal.get("append_cooldown_seconds", DEFAULT_APPEND_COOLDOWN)),
    )
    parser.add_argument(
        "--stable-min-votes", type=int, default=int(cal.get("stable_min_votes", DEFAULT_STABLE_MIN_VOTES))
    )
    parser.add_argument("--seq-len", type=int, default=DEFAULT_SEQ_LEN)
    args = parser.parse_args()
    if args.stable_min_votes > args.history_size:
        args.stable_min_votes = args.history_size

    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Motion model not found: {MODEL_PATH}")
    if not LABELS_PATH.exists():
        raise FileNotFoundError(f"Motion labels file not found: {LABELS_PATH}")
    bundle = load_motion_gru_checkpoint(MODEL_PATH)
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
    if task and task != "motion":
        raise RuntimeError("Labels metadata task must be 'motion'.")
    model_backend = str(meta.get("model_backend", "")).strip()
    if model_backend and model_backend != "torch_gru":
        raise RuntimeError("Motion labels metadata model_backend must be 'torch_gru'.")
    sequence_shape = meta.get("sequence_input_shape", [])
    seq_len = int(sequence_shape[0]) if isinstance(sequence_shape, list) and len(sequence_shape) == 2 else int(
        meta.get("seq_len", args.seq_len)
    )
    feature_dim = int(meta.get("feature_dim", bundle.get("feature_dim", 126)))
    input_representation = str(meta.get("input_representation", "")).strip()
    if input_representation and input_representation != "sequence":
        raise RuntimeError("Motion GRU labels metadata input_representation must be 'sequence'.")
    if int(bundle.get("seq_len", seq_len)) != seq_len:
        raise RuntimeError(
            f"GRU checkpoint seq_len mismatch: checkpoint has {bundle.get('seq_len')}, metadata has {seq_len}"
        )
    if int(bundle.get("feature_dim", feature_dim)) != feature_dim:
        raise RuntimeError(
            "GRU checkpoint feature_dim mismatch between model checkpoint and motion labels metadata."
        )

    print("Loaded motion labels:", labels)
    detector = create_detector(num_hands=MOTION_NUM_HANDS)
    pose_detector = create_pose_detector()
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Could not open webcam.")
    win = "ASL Motion Word Test"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    pred_history = deque(maxlen=args.history_size)
    prebuffer = deque(maxlen=MOTION_PREBUFFER_FRAMES)
    active_sequence: list[np.ndarray] = []
    text_buffer = ""
    last_append_time = 0.0
    last_vec: np.ndarray | None = None
    in_motion = False
    active_streak = 0
    idle_streak = 0
    last_segment_pred = "NO_HAND"
    last_segment_conf = 0.0
    print("Press Q or ESC to quit. \nPress C to clear text buffer. \nPress SPACE to add current stable prediction manually.")

    try:
        def flush_active_sequence() -> tuple[str, float]:
            nonlocal active_sequence, in_motion, active_streak, idle_streak, last_segment_pred, last_segment_conf
            if not active_sequence:
                return "NO_HAND", 0.0
            seq_arr = np.array(active_sequence[:MOTION_MAX_FRAMES_PER_SAMPLE], dtype=np.float32)
            probs = predict_sequence_probs(bundle, seq_arr)
            best_idx = int(np.argmax(probs))
            conf = float(probs[best_idx])
            pred = str(labels[best_idx]) if conf >= args.threshold else "UNKNOWN"
            pred_history.append(pred)
            active_sequence = []
            in_motion = False
            active_streak = 0
            idle_streak = 0
            last_segment_pred = pred
            last_segment_conf = conf
            return pred, conf

        while True:
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
            current_pred = last_segment_pred
            current_conf = last_segment_conf
            energy = 0.0

            if res.hand_landmarks:
                vec = extract_motion_features(res.hand_landmarks, pose_lms)
                if vec.shape[0] > feature_dim:
                    vec = vec[:feature_dim]
                elif vec.shape[0] < feature_dim:
                    vec = np.concatenate([vec, np.zeros(feature_dim - vec.shape[0], dtype=np.float32)], axis=0)
                prebuffer.append(vec)
                energy = motion_energy(vec, last_vec)
                is_active = energy >= (MOTION_KEEPALIVE_ENERGY if in_motion else MOTION_START_ENERGY)
                if is_active:
                    active_streak += 1
                    idle_streak = 0
                else:
                    active_streak = 0
                    if in_motion:
                        idle_streak += 1

                if not in_motion and active_streak >= 2:
                    in_motion = True
                    active_sequence = list(prebuffer)

                if in_motion:
                    active_sequence.append(vec)
                    current_pred = "CAPTURING"
                    current_conf = 0.0
                    if len(active_sequence) >= MOTION_MAX_FRAMES_PER_SAMPLE:
                        current_pred, current_conf = flush_active_sequence()
                    elif idle_streak >= MOTION_END_IDLE_FRAMES:
                        current_pred, current_conf = flush_active_sequence()
                    else:
                        last_vec = vec
                        current_pred = "CAPTURING"
                        current_conf = 0.0
                        now = time.time()
                        smoothed_pred = majority_vote(list(pred_history)) or "NO_HAND"
                        if (
                            smoothed_pred not in ("NO_HAND", "UNKNOWN", "CAPTURING")
                            and (now - last_append_time) > args.append_cooldown
                            and len(pred_history) == args.history_size
                            and list(pred_history).count(smoothed_pred) >= args.stable_min_votes
                        ):
                            if text_buffer:
                                text_buffer += " "
                            text_buffer += smoothed_pred
                            last_append_time = now
                        draw_text(frame, [
                            f"Prediction: {smoothed_pred}",
                            f"Current segment: {current_pred}",
                            f"Confidence: {current_conf:.2f}",
                            f"Energy: {energy:.3f}",
                            f"In motion: {'YES' if in_motion else 'NO'}",
                            f"Active buffer: {len(active_sequence)}",
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
                            if smoothed_pred not in ("NO_HAND", "UNKNOWN", "CAPTURING"):
                                if text_buffer:
                                    text_buffer += " "
                                text_buffer += smoothed_pred
                                last_append_time = time.time()
                        continue
                last_vec = vec
            else:
                if in_motion:
                    idle_streak += 1
                    if idle_streak >= MOTION_END_IDLE_FRAMES:
                        current_pred, current_conf = flush_active_sequence()
                else:
                    current_pred = "NO_HAND"
                    current_conf = 0.0
                active_streak = 0
                last_vec = None

            smoothed_pred = majority_vote(list(pred_history)) or "NO_HAND"
            now = time.time()

            if (
                smoothed_pred not in ("NO_HAND", "UNKNOWN", "CAPTURING")
                and (now - last_append_time) > args.append_cooldown
                and len(pred_history) == args.history_size
                and list(pred_history).count(smoothed_pred) >= args.stable_min_votes
            ):
                if text_buffer:
                    text_buffer += " "
                text_buffer += smoothed_pred
                last_append_time = now

            draw_text(frame, [
                f"Prediction: {smoothed_pred}",
                f"Current segment: {current_pred}",
                f"Confidence: {current_conf:.2f}",
                f"Energy: {energy:.3f}",
                f"In motion: {'YES' if in_motion else 'NO'}",
                f"Active buffer: {len(active_sequence)}",
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
                if smoothed_pred not in ("NO_HAND", "UNKNOWN", "CAPTURING"):
                    if text_buffer:
                        text_buffer += " "
                    text_buffer += smoothed_pred
                    last_append_time = time.time()
    finally:
        cap.release()
        cv2.destroyAllWindows()
        if hasattr(detector, "close"):
            detector.close()
        if hasattr(pose_detector, "close"):
            pose_detector.close()

if __name__ == "__main__":
    main()