"""
Motion ASL — same inference loop as test_motion.py (live_motion_test/runner.py).

GUI mode runs the training runner directly (only the bottom bar HUD differs).
Headless/API mode uses the same loop with JSON emit.
"""
from __future__ import annotations

import argparse
import sys
import time
from collections import Counter, deque

import cv2
import numpy as np

from backend.asl_runtime.camera import detect_rgb, open_webcam, read_frame
from backend.asl_runtime.config import MOTION_LABELS, MOTION_MODEL, ensure_training_path, load_calibration
from backend.asl_runtime.emit import emit
from backend.asl_runtime.gui import draw_bottom_gui_bar
from backend.asl_runtime.landmarks import draw_detection_overlay
from backend.asl_runtime.preview import encode_preview_b64
from backend.asl_runtime.srm_stream import create_motion_srm_stream

ensure_training_path()

try:
    import mediapipe as mp
except ImportError:
    raise SystemExit("Run: pip install mediapipe opencv-python numpy torch")

from dataset_builder import (  # noqa: E402
    MIN_SEQ_VALID_FRAMES,
    MOTION_BURST_END_IDLE_FRAMES,
    MOTION_IDLE_HISTORY,
    MOTION_LONG_MAX_FRAMES,
    MOTION_LIVE_MIN_FRAMES_BEFORE_IDLE,
    MOTION_LIVE_ONSET_SKIP_FRAMES,
    MOTION_MAX_FRAMES_PER_SAMPLE,
    MOTION_NUM_HANDS,
    MOTION_PREBUFFER_FRAMES,
    MOTION_START_WINDOW,
    MOTION_START_WINDOW_DELTA,
    adaptive_motion_thresholds,
    create_detector,
    create_pose_detector,
    draw_hand_landmarks,
    draw_motion_pose_overlay,
    extract_motion_features,
    motion_energy,
    motion_window_delta,
)
from motion_gru import load_motion_gru_checkpoint, predict_sequence_probs  # noqa: E402


def _append_motion_token(text_buffer: str, token: str) -> str:
    token = str(token).strip() or "NO_HAND"
    if text_buffer:
        return f"{text_buffer} {token}"
    return token


def _majority_vote(items: list[str]) -> str | None:
    if not items:
        return None
    return Counter(items).most_common(1)[0][0]


def _run_training_gui(args: argparse.Namespace) -> None:
    """OpenCV GUI loop — same segmentation/inference as headless mode + SRM bottom bar."""
    cal = load_calibration().get("motion", {})
    if not MOTION_MODEL.exists():
        raise FileNotFoundError(f"Motion model not found: {MOTION_MODEL}")

    import json

    bundle = load_motion_gru_checkpoint(MOTION_MODEL)
    with open(MOTION_LABELS, encoding="utf-8") as f:
        meta = json.load(f)
    labels = list(meta.get("labels", []))
    feature_dim = int(meta.get("feature_dim", bundle.get("feature_dim", 147)))
    onset_skip = int(MOTION_LIVE_ONSET_SKIP_FRAMES)
    threshold = float(args.threshold if args.threshold is not None else cal.get("confidence_threshold", 0.60))

    detector = create_detector(MOTION_NUM_HANDS, min_hand_detection_confidence=0.5, min_tracking_confidence=0.5)
    pose_detector = create_pose_detector()
    cap = open_webcam(args.camera_index, width=args.camera_width, height=args.camera_height)
    srm_stream = create_motion_srm_stream()

    pred_history: deque[str] = deque(maxlen=args.history_size)
    prebuffer: deque[np.ndarray] = deque(maxlen=MOTION_PREBUFFER_FRAMES)
    start_window: deque[np.ndarray] = deque(maxlen=MOTION_START_WINDOW)
    idle_energies: deque[float] = deque(maxlen=MOTION_IDLE_HISTORY)
    active_sequence: list[np.ndarray] = []
    text_buffer = ""
    in_motion = False
    active_streak = 0
    idle_streak = 0
    last_vec: np.ndarray | None = None
    win = "ASL Motion (backend.asl_runtime)"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(win, 960, 720)
    aw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    ah = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"Motion camera {aw}x{ah}. threshold={threshold}. Q/ESC quit, C clear, SPACE add.")

    def align_vec(vec: np.ndarray) -> np.ndarray:
        if vec.shape[0] > feature_dim:
            return vec[:feature_dim].astype(np.float32)
        if vec.shape[0] < feature_dim:
            return np.concatenate([vec, np.zeros(feature_dim - vec.shape[0], dtype=np.float32)]).astype(np.float32)
        return vec.astype(np.float32)

    def flush_segment() -> tuple[str, float]:
        nonlocal active_sequence, in_motion, active_streak, idle_streak, text_buffer
        if not active_sequence:
            return "NO_HAND", 0.0
        seq_arr = np.array(active_sequence[:MOTION_MAX_FRAMES_PER_SAMPLE], dtype=np.float32)
        if onset_skip > 0 and seq_arr.shape[0] > onset_skip:
            seq_arr = seq_arr[onset_skip:].astype(np.float32)
        if int(seq_arr.shape[0]) < max(int(args.min_segment_frames), int(MIN_SEQ_VALID_FRAMES)):
            active_sequence = []
            in_motion = False
            active_streak = 0
            idle_streak = 0
            return "NO_HAND", 0.0
        probs = predict_sequence_probs(bundle, seq_arr)
        best_idx = int(np.argmax(probs))
        conf = float(probs[best_idx])
        pred = str(labels[best_idx]) if conf >= threshold else "UNKNOWN"
        pred_history.append(pred)
        text_buffer = _append_motion_token(text_buffer, pred)
        active_sequence = []
        in_motion = False
        active_streak = 0
        idle_streak = 0
        return pred, conf

    def draw_hud(frame, prediction: str, confidence: float) -> None:
        buf = text_buffer.strip()
        if not buf:
            srm_stream.clear()
        else:
            srm_stream.sync_from_buffer(buf)
        draw_bottom_gui_bar(
            frame,
            translation=srm_stream.translation or "-",
            text_stream=buf or "-",
            prediction=prediction,
            confidence=float(confidence),
        )

    try:
        while True:
            ok, frame = read_frame(cap, flush=args.frame_flush)
            if not ok or frame is None:
                time.sleep(0.01)
                continue
            frame = cv2.flip(frame, 1)
            rgb = np.ascontiguousarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            res = detector.detect(mp_image)
            pose_res = pose_detector.detect(mp_image)
            pose_lms = pose_res.pose_landmarks[0] if getattr(pose_res, "pose_landmarks", None) else None

            current_pred = "NO_HAND"
            current_conf = 0.0
            segment_pred = "NO_HAND"

            if res.hand_landmarks:
                draw_hand_landmarks(frame, res.hand_landmarks)
                vec = align_vec(extract_motion_features(res.hand_landmarks, pose_lms))
                prebuffer.append(vec)
                start_window.append(vec)
                start_thr, keep_thr = adaptive_motion_thresholds(idle_energies)
                energy = motion_energy(vec, last_vec)
                if not in_motion and energy < start_thr:
                    idle_energies.append(energy)
                active_now = energy >= (keep_thr if in_motion else start_thr)
                subtle_active = (not in_motion) and motion_window_delta(start_window) >= MOTION_START_WINDOW_DELTA
                active_now = active_now or subtle_active
                started_now = False
                if active_now:
                    active_streak += 1
                    idle_streak = 0
                else:
                    active_streak = 0
                    if in_motion and len(active_sequence) >= MOTION_LIVE_MIN_FRAMES_BEFORE_IDLE:
                        idle_streak += 1
                if not in_motion and active_streak >= 2:
                    in_motion = True
                    active_sequence = list(prebuffer)
                    started_now = True
                if in_motion:
                    if not started_now:
                        active_sequence.append(vec)
                    segment_pred = "CAPTURING"
                    if len(active_sequence) >= MOTION_LONG_MAX_FRAMES or idle_streak >= MOTION_BURST_END_IDLE_FRAMES:
                        segment_pred, current_conf = flush_segment()
                        current_pred = segment_pred
                    last_vec = vec
                else:
                    last_vec = vec
            else:
                if in_motion:
                    idle_streak += 1
                    if idle_streak >= MOTION_BURST_END_IDLE_FRAMES:
                        segment_pred, current_conf = flush_segment()
                        current_pred = segment_pred
                    else:
                        segment_pred = "CAPTURING"
                else:
                    active_streak = 0
                    last_vec = None

            if pose_lms is not None:
                draw_motion_pose_overlay(frame, pose_lms)

            smoothed = _majority_vote(list(pred_history)) or "NO_HAND"
            show_pred = segment_pred if segment_pred != "NO_HAND" else smoothed
            hud = frame.copy()
            draw_hud(hud, show_pred, current_conf)
            cv2.imshow(win, hud)
            key = cv2.waitKey(1) & 0xFF
            if key in (27, ord("q")):
                break
            if key == ord("c"):
                text_buffer = ""
                srm_stream.clear()
            elif key == 32:
                token = smoothed if smoothed not in ("NO_HAND", "UNKNOWN", "CAPTURING") else show_pred
                if token not in ("NO_HAND", "UNKNOWN", "CAPTURING"):
                    text_buffer = _append_motion_token(text_buffer, token)
    finally:
        cap.release()
        cv2.destroyAllWindows()
        if hasattr(detector, "close"):
            detector.close()
        if hasattr(pose_detector, "close"):
            pose_detector.close()


def _run_headless(args: argparse.Namespace) -> None:
    """Headless loop for API — same segmentation/predict as training; JSON + optional detect resize."""
    cal = load_calibration().get("motion", {})
    if not MOTION_MODEL.exists():
        raise FileNotFoundError(f"Motion model not found: {MOTION_MODEL}")

    import json

    bundle = load_motion_gru_checkpoint(MOTION_MODEL)
    with open(MOTION_LABELS, encoding="utf-8") as f:
        meta = json.load(f)
    labels = list(meta.get("labels", []))
    feature_dim = int(meta.get("feature_dim", bundle.get("feature_dim", 147)))
    onset_skip = int(MOTION_LIVE_ONSET_SKIP_FRAMES)
    threshold = float(args.threshold if args.threshold is not None else cal.get("confidence_threshold", 0.60))

    if args.detect_width < 0:
        detect_width = 960
    else:
        detect_width = 0 if args.detect_width == 0 else args.detect_width

    detector = create_detector(MOTION_NUM_HANDS, min_hand_detection_confidence=0.5, min_tracking_confidence=0.5)
    pose_detector = create_pose_detector()
    cap = open_webcam(args.camera_index, width=args.camera_width, height=args.camera_height)

    pred_history: deque[str] = deque(maxlen=args.history_size)
    prebuffer: deque[np.ndarray] = deque(maxlen=MOTION_PREBUFFER_FRAMES)
    start_window: deque[np.ndarray] = deque(maxlen=MOTION_START_WINDOW)
    idle_energies: deque[float] = deque(maxlen=MOTION_IDLE_HISTORY)
    active_sequence: list[np.ndarray] = []
    srm_stream = create_motion_srm_stream()
    in_motion = False
    active_streak = 0
    idle_streak = 0
    last_vec: np.ndarray | None = None
    preview_state: dict = {}

    emit({"type": "started", "mode": "motion", "labels": labels, "script": "test_motion.py"})

    def align_vec(vec: np.ndarray) -> np.ndarray:
        if vec.shape[0] > feature_dim:
            return vec[:feature_dim].astype(np.float32)
        if vec.shape[0] < feature_dim:
            return np.concatenate([vec, np.zeros(feature_dim - vec.shape[0], dtype=np.float32)]).astype(np.float32)
        return vec.astype(np.float32)

    def flush_segment() -> tuple[str, float]:
        nonlocal active_sequence, in_motion, active_streak, idle_streak
        if not active_sequence:
            return "NO_HAND", 0.0
        seq_arr = np.array(active_sequence[:MOTION_MAX_FRAMES_PER_SAMPLE], dtype=np.float32)
        if onset_skip > 0 and seq_arr.shape[0] > onset_skip:
            seq_arr = seq_arr[onset_skip:].astype(np.float32)
        if int(seq_arr.shape[0]) < max(int(args.min_segment_frames), int(MIN_SEQ_VALID_FRAMES)):
            active_sequence = []
            in_motion = False
            active_streak = 0
            idle_streak = 0
            return "NO_HAND", 0.0
        probs = predict_sequence_probs(bundle, seq_arr)
        best_idx = int(np.argmax(probs))
        conf = float(probs[best_idx])
        pred = str(labels[best_idx]) if conf >= threshold else "UNKNOWN"
        pred_history.append(pred)
        if pred not in ("UNKNOWN", "NO_HAND"):
            srm_stream.add_word(pred)
        active_sequence = []
        in_motion = False
        active_streak = 0
        idle_streak = 0
        return pred, conf

    def _frame_rgb(bgr):
        if detect_width > 0 and bgr.shape[1] > detect_width:
            return detect_rgb(bgr, max_width=detect_width)
        return np.ascontiguousarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))

    try:
        while True:
            ok, frame = read_frame(cap, flush=args.frame_flush)
            if not ok or frame is None:
                time.sleep(0.01)
                continue
            frame = cv2.flip(frame, 1)
            rgb = _frame_rgb(frame)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            res = detector.detect(mp_image)
            pose_res = pose_detector.detect(mp_image)
            pose_lms = pose_res.pose_landmarks[0] if getattr(pose_res, "pose_landmarks", None) else None
            current_pred = "NO_HAND"
            current_conf = 0.0
            motion_flushed = False

            if res.hand_landmarks:
                vec = align_vec(extract_motion_features(res.hand_landmarks, pose_lms))
                prebuffer.append(vec)
                start_window.append(vec)
                start_thr, keep_thr = adaptive_motion_thresholds(idle_energies)
                energy = motion_energy(vec, last_vec)
                if not in_motion and energy < start_thr:
                    idle_energies.append(energy)
                active_now = energy >= (keep_thr if in_motion else start_thr)
                subtle_active = (not in_motion) and motion_window_delta(start_window) >= MOTION_START_WINDOW_DELTA
                active_now = active_now or subtle_active
                started_now = False
                if active_now:
                    active_streak += 1
                    idle_streak = 0
                else:
                    active_streak = 0
                    if in_motion and len(active_sequence) >= MOTION_LIVE_MIN_FRAMES_BEFORE_IDLE:
                        idle_streak += 1
                if not in_motion and active_streak >= 2:
                    in_motion = True
                    active_sequence = list(prebuffer)
                    started_now = True
                if in_motion:
                    if not started_now:
                        active_sequence.append(vec)
                    if len(active_sequence) >= MOTION_LONG_MAX_FRAMES or idle_streak >= MOTION_BURST_END_IDLE_FRAMES:
                        current_pred, current_conf = flush_segment()
                        motion_flushed = True
                    else:
                        current_pred = "CAPTURING"
                    last_vec = vec
                else:
                    last_vec = vec
            else:
                if in_motion:
                    idle_streak += 1
                    if idle_streak >= MOTION_BURST_END_IDLE_FRAMES:
                        current_pred, current_conf = flush_segment()
                        motion_flushed = True
                    else:
                        current_pred = "CAPTURING"
                else:
                    active_streak = 0
                    last_vec = None

            smoothed = Counter(pred_history).most_common(1)[0][0] if pred_history else "NO_HAND"
            vis = frame.copy()
            draw_detection_overlay(vis, res.hand_landmarks, pose_lms)
            preview = encode_preview_b64(vis, preview_state)
            payload = {
                "type": "segment" if motion_flushed else "frame",
                "mode": "motion",
                "prediction": smoothed,
                "segment": current_pred,
                "confidence": round(float(current_conf), 3),
                "text": srm_stream.translation,
                "words": srm_stream.session_text,
                "motion_flushed": motion_flushed,
                "n_hands": len(res.hand_landmarks) if res.hand_landmarks else 0,
            }
            if preview:
                payload["preview_b64"] = preview
            emit(payload)
    finally:
        cap.release()
        if hasattr(detector, "close"):
            detector.close()
        if hasattr(pose_detector, "close"):
            pose_detector.close()
        emit({"type": "stopped"})


def main() -> None:
    cal = load_calibration().get("motion", {})
    parser = argparse.ArgumentParser(description="Motion ASL — test_motion.py logic, custom bottom bar GUI.")
    parser.add_argument("--threshold", type=float, default=float(cal.get("confidence_threshold", 0.60)))
    parser.add_argument("--history-size", type=int, default=int(cal.get("history_size", 6)))
    parser.add_argument("--min-segment-frames", type=int, default=int(cal.get("min_segment_frames", 8)))
    parser.add_argument("--camera-index", type=int, default=0)
    parser.add_argument("--camera-width", type=int, default=1280)
    parser.add_argument("--camera-height", type=int, default=720)
    parser.add_argument("--detect-width", type=int, default=-1, help="Headless only. -1=960, 0=full.")
    parser.add_argument("--frame-flush", action="store_true")
    parser.add_argument("--quality", action="store_true")
    parser.add_argument("--gui", action="store_true")
    parser.add_argument("--no-gui", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if args.no_gui:
        args.gui = False
    use_json = args.json or not args.gui
    if args.gui and not use_json:
        _run_training_gui(args)
    else:
        if args.quality:
            args.camera_width = 1920
            args.camera_height = 1080
            if args.detect_width in (-1, 960):
                args.detect_width = 1280
        _run_headless(args)


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
