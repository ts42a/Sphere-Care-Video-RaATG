"""
Headless static ASL loop — same logic as ai/training/ai_transcript/test.py (no training files modified).
"""
from __future__ import annotations

import argparse
import time
import urllib.request
from collections import Counter, deque
from pathlib import Path

import cv2
import joblib
import numpy as np

from backend.asl_runtime.camera import detect_rgb, open_webcam, read_frame
from backend.asl_runtime.config import (
    MP_MODEL_DIR,
    STATIC_LABELS,
    STATIC_MODEL,
    TRAINING_ROOT,
    load_calibration,
)
from backend.asl_runtime.emit import emit
from backend.asl_runtime.gui import build_text_stream, draw_bottom_gui_bar, handle_gui_keys
from backend.asl_runtime.landmarks import draw_detection_overlay
from backend.asl_runtime.preview import encode_preview_b64

try:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_tasks
    from mediapipe.tasks.python import vision
except ImportError:
    raise SystemExit("Run: pip install mediapipe opencv-python numpy joblib")


def _hand_model_path() -> str:
    MP_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    path = MP_MODEL_DIR / "hand_landmarker.task"
    if not path.exists():
        url = (
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
            "hand_landmarker/float16/1/hand_landmarker.task"
        )
        urllib.request.urlretrieve(url, str(path))
    return str(path)


def create_detector(num_hands: int = 1):
    base = mp_tasks.BaseOptions(model_asset_path=_hand_model_path())
    opts = vision.HandLandmarkerOptions(
        base_options=base,
        num_hands=num_hands,
        min_hand_detection_confidence=0.6,
        min_tracking_confidence=0.6,
    )
    return vision.HandLandmarker.create_from_options(opts)


def extract_hand_features(hand_landmarks) -> np.ndarray:
    pts = np.array([[lm.x, lm.y, lm.z] for lm in hand_landmarks], dtype=np.float32)
    pts -= pts[0:1, :]
    d = np.linalg.norm(pts[:, :2], axis=1)
    s = float(np.max(d)) if np.max(d) > 1e-6 else 1.0
    pts /= s
    return pts.reshape(-1).astype(np.float32)


def majority_vote(items):
    if not items:
        return None
    return Counter(items).most_common(1)[0][0]


def main() -> None:
    cal = load_calibration().get("static", {})
    parser = argparse.ArgumentParser(description="Backend static ASL webcam (test.py parity).")
    parser.add_argument("--threshold", type=float, default=float(cal.get("confidence_threshold", 0.54)))
    parser.add_argument("--history-size", type=int, default=int(cal.get("history_size", 8)))
    parser.add_argument("--append-cooldown", type=float, default=float(cal.get("append_cooldown_seconds", 1.0)))
    parser.add_argument("--stable-min-votes", type=int, default=int(cal.get("stable_min_votes", 6)))
    parser.add_argument("--camera-index", type=int, default=0)
    parser.add_argument("--camera-width", type=int, default=1280)
    parser.add_argument("--camera-height", type=int, default=720)
    parser.add_argument(
        "--detect-width",
        type=int,
        default=960,
        help="MediaPipe input width (default 960=fast, 1280=quality, 0=full res).",
    )
    parser.add_argument(
        "--frame-flush",
        action="store_true",
        help="Drop stale camera buffers each frame (less flicker, slightly slower).",
    )
    parser.add_argument(
        "--quality",
        action="store_true",
        help="HD mode: 1920x1080 camera + detect 1280 (sharper, slower).",
    )
    parser.add_argument(
        "--gui",
        action="store_true",
        help="OpenCV window like test.py (Q/ESC quit, C clear, SPACE append).",
    )
    parser.add_argument(
        "--no-gui",
        action="store_true",
        help="Headless JSON only (used by API subprocess).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit JSON lines to stdout (default when --gui is off; optional with --gui).",
    )
    args = parser.parse_args()
    if args.no_gui:
        args.gui = False
    use_json = args.json or not args.gui
    if args.stable_min_votes > args.history_size:
        args.stable_min_votes = args.history_size
    if args.quality:
        args.camera_width = 1920
        args.camera_height = 1080
        if args.detect_width == 960:
            args.detect_width = 1280
    detect_width = args.detect_width if args.detect_width > 0 else args.camera_width
    overlay_hold = 4 if args.quality else 0

    if not STATIC_MODEL.exists():
        raise FileNotFoundError(f"Static model not found: {STATIC_MODEL}")

    model = joblib.load(STATIC_MODEL)
    with open(STATIC_LABELS, encoding="utf-8") as f:
        import json

        labels = json.load(f).get("labels", [])

    detector = create_detector(num_hands=1)
    cap = open_webcam(
        args.camera_index,
        width=args.camera_width,
        height=args.camera_height,
    )

    pred_history: deque[str] = deque(maxlen=args.history_size)
    text_buffer = ""
    last_append_time = 0.0
    preview_state: dict = {}
    zone_state: dict = {"score": 0}
    last_hands = None
    hands_hold = 0
    win = "ASL Static (backend.asl_runtime)"
    if args.gui:
        cv2.namedWindow(win, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(win, 960, 720)
        aw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        ah = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        mode = "quality" if args.quality else "fast"
        print(f"Camera {aw}x{ah}, detect {detect_width}px ({mode}). Q/ESC quit.")
    if use_json:
        emit({"type": "started", "mode": "static", "labels": labels, "script": "test.py"})

    try:
        while True:
            ok, frame = read_frame(cap, flush=args.frame_flush)
            if not ok or frame is None:
                time.sleep(0.01)
                continue
            frame = cv2.flip(frame, 1)
            rgb = detect_rgb(frame, max_width=detect_width)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            res = detector.detect(mp_image)
            current_pred = "NO_HAND"
            current_conf = 0.0
            landmarks: list = []

            if res.hand_landmarks:
                hand = res.hand_landmarks[0]
                landmarks = [[lm.x, lm.y, lm.z] for lm in hand]
                vec = extract_hand_features(hand).reshape(1, -1)
                pred = model.predict(vec)[0]
                if hasattr(model, "predict_proba"):
                    probs = model.predict_proba(vec)[0]
                    best_idx = int(np.argmax(probs))
                    current_conf = float(probs[best_idx])
                    current_pred = str(pred) if current_conf >= args.threshold else "UNKNOWN"
                else:
                    current_pred = str(pred)
                    current_conf = 1.0

            pred_history.append(current_pred)
            smoothed = majority_vote(list(pred_history)) or "NO_HAND"
            now = time.time()
            appended = False
            if (
                smoothed not in ("NO_HAND", "UNKNOWN")
                and (now - last_append_time) > args.append_cooldown
                and len(pred_history) == args.history_size
                and list(pred_history).count(smoothed) >= args.stable_min_votes
            ):
                text_buffer += smoothed
                last_append_time = now
                appended = True

            if res.hand_landmarks:
                last_hands = res.hand_landmarks
                hands_hold = overlay_hold if overlay_hold > 0 else 1
            elif overlay_hold > 0 and hands_hold > 0:
                hands_hold -= 1
            else:
                last_hands = None
                hands_hold = 0
            hands_draw = res.hand_landmarks if res.hand_landmarks else (last_hands if hands_hold > 0 else None)
            vis = frame.copy()
            draw_detection_overlay(vis, hands_draw, static_target=True, zone_state=zone_state)

            payload = {
                "type": "frame",
                "mode": "static",
                "prediction": smoothed,
                "segment": smoothed,
                "confidence": round(current_conf, 3),
                "text": text_buffer,
                "raw_text": text_buffer,
                "landmarks": landmarks,
                "text_appended": appended,
                "letter": smoothed if appended else "",
            }
            if args.gui:
                hud = vis
                show_pred = current_pred if current_pred not in ("NO_HAND", "UNKNOWN") else smoothed
                draw_bottom_gui_bar(
                    hud,
                    text_buffer=text_buffer,
                    text_stream=build_text_stream(text_buffer, show_pred),
                    prediction=show_pred,
                    confidence=current_conf,
                )
                cv2.imshow(win, hud)
                key = cv2.waitKey(1) & 0xFF
                text_buffer, quit_now = handle_gui_keys(key, text_buffer, smoothed)
                if quit_now:
                    break
            if use_json:
                preview = encode_preview_b64(vis, preview_state)
                if preview:
                    payload["preview_b64"] = preview
                emit(payload)
    finally:
        cap.release()
        if args.gui:
            cv2.destroyAllWindows()
        if hasattr(detector, "close"):
            detector.close()
        if use_json:
            emit({"type": "stopped"})


if __name__ == "__main__":
    import sys
    from pathlib import Path

    if __package__ is None:
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        argv = sys.argv[1:]
        if "--gui" not in argv and "--no-gui" not in argv:
            sys.argv.append("--gui")
    try:
        main()
    except Exception as exc:
        emit({"type": "error", "detail": str(exc)})
        raise
