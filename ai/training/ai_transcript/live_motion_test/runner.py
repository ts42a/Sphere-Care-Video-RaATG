# Live motion-word webcam test — same 4-thumb layout as dataset_builder (start1 / start2 / mid / end).
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from collections import deque, Counter
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from dataset_manifest import RAW_CUSTOM_DIR, append_sample_manifest
# ai_transcript is parent of live_motion_test/
ROOT = Path(__file__).resolve().parents[1]

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dataset_builder import (
    MOTION_BURST_END_IDLE_FRAMES,
    MOTION_IDLE_HISTORY,
    MOTION_LONG_MAX_FRAMES,
    MOTION_LIVE_MIN_FRAMES_BEFORE_IDLE,
    MOTION_LIVE_ONSET_SKIP_FRAMES,
    MOTION_MAX_FRAMES_PER_SAMPLE,
    MIN_SEQ_VALID_FRAMES,
    MOTION_NUM_HANDS,
    MOTION_POSE_LANDMARKS,
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
    sanitize_motion_label,
)
from motion_gru import load_motion_gru_checkpoint, predict_sequence_probs

try:
    import mediapipe as mp
except ImportError:
    raise SystemExit("Run: py -m pip install mediapipe opencv-python numpy torch")


ARTIFACTS_DIR = ROOT / "artifacts" / "gesture"
LIVE_SESSIONS_DIR = ARTIFACTS_DIR / "live_sessions"
MODEL_PATH = ARTIFACTS_DIR / "motion_model.pt"
LABELS_PATH = ARTIFACTS_DIR / "motion_labels.json"
CALIBRATION_PATH = ARTIFACTS_DIR / "decoder_calibration.json"

DEFAULT_SEQ_LEN = 10
DEFAULT_PRED_HISTORY_SIZE = 6
DEFAULT_CONFIDENCE_THRESHOLD = 0.60
DEFAULT_APPEND_COOLDOWN = 1.2
DEFAULT_STABLE_MIN_VOTES = 4
DEFAULT_MIN_SEGMENT_FRAMES = 8

# Same index recipe as dataset_builder.draw_frame_strip_preview
STRIP_LABELS = ["start1", "start2", "mid", "end"]


def strip_frame_indices(num_frames: int) -> list[int]:
    if num_frames <= 0:
        return [0, 0, 0, 0]
    n = num_frames
    return [0, min(1, n - 1), n // 2, n - 1]


def save_segment_strip(
    session_dir: Path,
    segment_idx: int,
    preview_frames: list[np.ndarray],
    meta: dict,
) -> None:
    """Save 4 PNGs (training-style strip) + segment JSON."""
    n = len(preview_frames)
    if n == 0:
        return
    slots = strip_frame_indices(n)
    for i, name in enumerate(STRIP_LABELS):
        idx = max(0, min(n - 1, slots[i]))
        img = preview_frames[idx]
        if img is None or img.size == 0:
            continue
        out = session_dir / f"segment_{segment_idx:04d}_{name}.png"
        cv2.imwrite(str(out), img)
    meta_path = session_dir / f"segment_{segment_idx:04d}.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)


def _load_calibration_defaults() -> dict:
    if not CALIBRATION_PATH.exists():
        return {}
    with open(CALIBRATION_PATH, "r", encoding="utf-8") as f:
        try:
            payload = json.load(f)
        except json.JSONDecodeError:
            return {}
    return payload.get("motion", {}) if isinstance(payload, dict) else {}


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


def append_token(text_buffer: str, token: str) -> str:
    token = str(token).strip() or "NO_HAND"
    if text_buffer:
        return f"{text_buffer} {token}"
    return token


def _normalize_feedback_label(raw: str, fallback: str) -> str:
    text = (raw or "").strip()
    if not text:
        return fallback
    up = text.upper().replace(" ", "")
    if up in ("X", "SKIP", "S"):
        return "SKIP"
    if up in ("U", "UNK", "UNKNOWN"):
        return "UNKNOWN"
    if up in ("NOHAND", "NO_HAND"):
        return "NO_HAND"
    try:
        return sanitize_motion_label(text)
    except Exception:
        return up


def _show_feedback_strip_frames(mid_frame_path: str, *, pred: str, conf: float, seg_idx: int) -> None:
    p = Path(mid_frame_path)
    if not p.exists():
        return
    stem = p.stem
    if stem.endswith("_mid"):
        stem = stem[: -len("_mid")]
    tiles: list[np.ndarray] = []
    tile_w = 480
    tile_h = 360
    for name in STRIP_LABELS:
        img_path = p.with_name(f"{stem}_{name}.png")
        img = cv2.imread(str(img_path)) if img_path.exists() else None
        if img is None or img.size == 0:
            img = np.zeros((tile_h, tile_w, 3), dtype=np.uint8)
        else:
            img = cv2.resize(img, (tile_w, tile_h), interpolation=cv2.INTER_AREA)
        cv2.putText(
            img,
            name,
            (10, 24),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.75,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        tiles.append(img)
    strip = np.hstack(tiles)
    banner_h = 90
    banner = np.zeros((banner_h, strip.shape[1], 3), dtype=np.uint8)
    draw_text(
        banner,
        [
            f"Segment {seg_idx:04d} (start1/start2/mid/end)",
            f"Predicted: {pred} ({conf:.2f})",
        ],
        x=10,
        y=26,
        gap=24,
    )
    preview = np.vstack([banner, strip])
    h, w = preview.shape[:2]
    scale = min(800 / max(w, 1), 300 / max(h, 1), 1.0)
    if scale < 1.0:
        preview = cv2.resize(preview, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    win = "Session Feedback Preview"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    cv2.imshow(win, preview)
    cv2.waitKey(1)


def _input_with_gui_pump(prompt: str, *, win: str = "Session Feedback Preview") -> str:
    """Read terminal input without freezing the OpenCV feedback window."""
    result: dict[str, str] = {"value": ""}

    def _reader() -> None:
        try:
            result["value"] = input(prompt)
        except EOFError:
            result["value"] = ""

    t = threading.Thread(target=_reader, daemon=True)
    t.start()
    while t.is_alive():
        try:
            cv2.waitKey(30)
        except Exception:
            pass
        time.sleep(0.02)
    return result["value"]


def _pose_tracks_ok(pose_lms) -> bool:
    if pose_lms is None:
        return False
    try:
        return len(pose_lms) >= max(MOTION_POSE_LANDMARKS) + 1
    except TypeError:
        return False


def main() -> None:
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
    parser.add_argument(
        "--min-segment-frames",
        type=int,
        default=int(cal.get("min_segment_frames", DEFAULT_MIN_SEGMENT_FRAMES)),
        help="Ignore live segments shorter than this many frames before prediction.",
    )
    parser.add_argument("--seq-len", type=int, default=DEFAULT_SEQ_LEN)
    parser.add_argument(
        "--onset-skip",
        type=int,
        default=-1,
        help="Frames to drop from start of each segment before GRU (-1 = MOTION_LIVE_ONSET_SKIP_FRAMES).",
    )
    parser.add_argument(
        "--no-session-save",
        action="store_true",
        help="Do not create a session folder or save 4-frame strips.",
    )
    args = parser.parse_args()
    if args.stable_min_votes > args.history_size:
        args.stable_min_votes = args.history_size
    args.min_segment_frames = max(1, int(args.min_segment_frames))

    onset_skip = (
        int(MOTION_LIVE_ONSET_SKIP_FRAMES) if args.onset_skip < 0 else max(0, int(args.onset_skip))
    )

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
        raise RuntimeError("Motion labels metadata input_representation must be 'sequence'.")
    if int(bundle.get("seq_len", seq_len)) != seq_len:
        raise RuntimeError(
            f"GRU checkpoint seq_len mismatch: checkpoint has {bundle.get('seq_len')}, metadata has {seq_len}"
        )
    if int(bundle.get("feature_dim", feature_dim)) != feature_dim:
        raise RuntimeError(
            "GRU checkpoint feature_dim mismatch between model checkpoint and motion labels metadata."
        )

    session_dir: Path | None = None
    if not args.no_session_save:
        LIVE_SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        session_dir = LIVE_SESSIONS_DIR / session_id
        session_dir.mkdir(parents=True, exist_ok=False)
        session_info = {
            "session_id": session_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "model_path": str(MODEL_PATH.resolve()),
            "labels_path": str(LABELS_PATH.resolve()),
            "onset_skip": onset_skip,
            "strip_layout": "start1, start2, mid, end (same indices as dataset_builder); PNGs include hand skeleton overlay (draw_hand_landmarks)",
            "note": "Loads whatever motion_model.pt / motion_labels.json exist at session start — re-run train.py to refresh.",
        }
        with open(session_dir / "session.json", "w", encoding="utf-8") as f:
            json.dump(session_info, f, indent=2)
        print("Session folder:", session_dir)

    print("Loaded motion labels:", labels)
    print(
        f"Using checkpoint: {MODEL_PATH.resolve()} (updated each time you run train.py --mode motion)."
    )
    print(
        "Motion segmentation: adaptive thresholds + windowΔ (no visible-only start); "
        f"min_frames_before_idle={MOTION_LIVE_MIN_FRAMES_BEFORE_IDLE}; onset_skip={onset_skip}."
    )
    print(
        f"Hands: up to {MOTION_NUM_HANDS} (slightly lower detect threshold for live) + pose overlay "
        f"(same 147-D layout as training)."
    )
    detector = create_detector(
        MOTION_NUM_HANDS,
        min_hand_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    pose_detector = create_pose_detector()
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Could not open webcam.")
    win = "ASL Motion Word Test"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    pred_history = deque(maxlen=args.history_size)
    prebuffer: deque[np.ndarray] = deque(maxlen=MOTION_PREBUFFER_FRAMES)
    prebuffer_frames: deque[np.ndarray] = deque(maxlen=MOTION_PREBUFFER_FRAMES)
    start_window: deque[np.ndarray] = deque(maxlen=MOTION_START_WINDOW)
    idle_energies: deque[float] = deque(maxlen=MOTION_IDLE_HISTORY)
    active_sequence: list[np.ndarray] = []
    active_preview_frames: list[np.ndarray] = []
    text_buffer = ""
    last_append_time = 0.0
    last_vec: np.ndarray | None = None
    in_motion = False
    active_streak = 0
    idle_streak = 0
    segment_idx = 0
    last_segment_pred = "NO_HAND"
    last_segment_conf = 0.0
    last_accept_conf = 0.0
    session_segment_records: list[dict] = []
    print("Press Q or ESC to quit. \nPress C to clear text buffer. \nPress SPACE to add current stable prediction manually.")

    try:
        def flush_active_sequence() -> tuple[str, float]:
            nonlocal active_sequence, active_preview_frames, in_motion, active_streak, idle_streak
            nonlocal last_segment_pred, last_segment_conf, segment_idx, last_accept_conf
            nonlocal text_buffer, last_append_time, session_segment_records
            if not active_sequence:
                return "NO_HAND", 0.0
            previews = [np.copy(x) for x in active_preview_frames[:MOTION_MAX_FRAMES_PER_SAMPLE]]
            seq_arr = np.array(active_sequence[:MOTION_MAX_FRAMES_PER_SAMPLE], dtype=np.float32)
            raw_frames = int(seq_arr.shape[0])
            if onset_skip > 0 and seq_arr.shape[0] > onset_skip:
                seq_arr = seq_arr[onset_skip:].astype(np.float32)
            if int(seq_arr.shape[0]) < max(int(args.min_segment_frames), int(MIN_SEQ_VALID_FRAMES)):
                active_sequence = []
                active_preview_frames = []
                in_motion = False
                active_streak = 0
                idle_streak = 0
                return "NO_HAND", 0.0
            probs = predict_sequence_probs(bundle, seq_arr)
            best_idx = int(np.argmax(probs))
            conf = float(probs[best_idx])
            pred = str(labels[best_idx]) if conf >= args.threshold else "UNKNOWN"
            pred_history.append(pred)
            text_buffer = append_token(text_buffer, pred)
            last_append_time = time.time()

            if session_dir is not None and previews:
                segment_idx += 1
                top = sorted(
                    [(labels[i], float(probs[i])) for i in range(len(labels))],
                    key=lambda t: -t[1],
                )[:5]
                sq = seq_arr
                second_slot = sq[:, 63:126] if sq.shape[1] >= 126 else np.zeros((len(sq), 63), dtype=np.float32)
                pose_slot = sq[:, 126:147] if sq.shape[1] >= 147 else np.zeros((len(sq), 21), dtype=np.float32)
                frames_2h = int(np.sum(np.linalg.norm(second_slot, axis=1) > 1e-3))
                frames_pose = int(np.sum(np.linalg.norm(pose_slot, axis=1) > 1e-3))
                seq_path = session_dir / f"segment_{segment_idx:04d}.npz"
                np.savez(str(seq_path), seq=seq_arr.astype(np.float32))
                save_segment_strip(
                    session_dir,
                    segment_idx,
                    previews,
                    {
                        "segment_index": segment_idx,
                        "prediction": pred,
                        "confidence": conf,
                        "threshold": float(args.threshold),
                        "raw_capture_frames": raw_frames,
                        "onset_skip_applied": onset_skip,
                        "model_input_frames_after_skip": int(seq_arr.shape[0]),
                        "top5": top,
                        "feature_layout": "126 hands (L+R) + 21 pose = 147",
                        "frames_nonzero_second_hand_slot": frames_2h,
                        "frames_nonzero_pose_slot": frames_pose,
                        "tensor_path": str(seq_path.name),
                        "mid_frame_path": f"segment_{segment_idx:04d}_mid.png",
                    },
                )
                session_segment_records.append(
                    {
                        "segment_index": int(segment_idx),
                        "prediction": pred,
                        "confidence": float(conf),
                        "tensor_path": str(seq_path),
                        "mid_frame_path": str(session_dir / f"segment_{segment_idx:04d}_mid.png"),
                    }
                )
                print(f"Saved strip + metadata: segment_{segment_idx:04d} in {session_dir}")

            active_sequence = []
            active_preview_frames = []
            in_motion = False
            active_streak = 0
            idle_streak = 0
            last_segment_pred = pred
            last_segment_conf = conf
            if pred not in ("NO_HAND", "UNKNOWN", "CAPTURING") and conf >= float(args.threshold):
                last_accept_conf = conf
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
            pose_ok = _pose_tracks_ok(pose_lms)
            if pose_ok and pose_lms is not None:
                draw_motion_pose_overlay(frame, pose_lms)
            n_hands = len(res.hand_landmarks) if res.hand_landmarks else 0
            if res.hand_landmarks:
                draw_hand_landmarks(frame, res.hand_landmarks)
            track_hud = (
                f"Hands {n_hands}/{MOTION_NUM_HANDS}"
                + (" — add 2nd hand!" if n_hands == 1 else "")
                + f" | Body: {'OK' if pose_ok else 'weak'}"
            )

            current_pred = last_segment_pred
            current_conf = last_segment_conf
            energy = 0.0
            current_start_threshold, current_keep_threshold = adaptive_motion_thresholds(idle_energies)
            window_delta = 0.0

            if res.hand_landmarks:
                vec = extract_motion_features(res.hand_landmarks, pose_lms)
                if vec.shape[0] > feature_dim:
                    vec = vec[:feature_dim]
                elif vec.shape[0] < feature_dim:
                    vec = np.concatenate([vec, np.zeros(feature_dim - vec.shape[0], dtype=np.float32)], axis=0)
                prebuffer.append(vec)
                prebuffer_frames.append(frame.copy())
                start_window.append(vec)
                energy = motion_energy(vec, last_vec)
                window_delta = motion_window_delta(start_window)
                if not in_motion and energy < current_start_threshold:
                    idle_energies.append(energy)
                active_now = energy >= (current_keep_threshold if in_motion else current_start_threshold)
                subtle_active = (not in_motion) and window_delta >= MOTION_START_WINDOW_DELTA
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
                    active_preview_frames = list(prebuffer_frames)
                    started_now = True

                if in_motion:
                    if not started_now:
                        active_sequence.append(vec)
                        active_preview_frames.append(frame.copy())
                    current_pred = "CAPTURING"
                    current_conf = 0.0
                    if len(active_sequence) >= MOTION_LONG_MAX_FRAMES:
                        current_pred, current_conf = flush_active_sequence()
                    elif idle_streak >= MOTION_BURST_END_IDLE_FRAMES:
                        current_pred, current_conf = flush_active_sequence()
                    else:
                        last_vec = vec
                        current_pred = "CAPTURING"
                        current_conf = 0.0
                        smoothed_pred = majority_vote(list(pred_history)) or "NO_HAND"
                        sess_line = str(session_dir.name) if session_dir else "(no save)"
                        draw_text(frame, [
                            f"Prediction: {smoothed_pred}",
                            f"Current segment: {current_pred}",
                            f"Confidence: {current_conf:.2f}",
                            track_hud,
                            f"Energy: {energy:.3f} | winΔ: {window_delta:.3f}",
                            f"Start/Keep thr: {current_start_threshold:.3f} / {current_keep_threshold:.3f}",
                            f"In motion: {'YES' if in_motion else 'NO'}",
                            f"Active buffer: {len(active_sequence)} | onset_skip={onset_skip}",
                            f"Session: {sess_line}",
                            f"Text: {text_buffer if text_buffer else '(empty)'}",
                            f"Labels: {', '.join(labels)}",
                            "Keys: C clear, SPACE add, Q/ESC quit",
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
                    if idle_streak >= MOTION_BURST_END_IDLE_FRAMES:
                        current_pred, current_conf = flush_active_sequence()
                else:
                    current_pred = "NO_HAND"
                    current_conf = 0.0
                active_streak = 0
                last_vec = None

            smoothed_pred = majority_vote(list(pred_history)) or "NO_HAND"
            now = time.time()

            sess_line = str(session_dir.name) if session_dir else "(no save)"
            draw_text(frame, [
                f"Prediction: {smoothed_pred}",
                f"Current segment: {current_pred}",
                f"Confidence: {current_conf:.2f}",
                track_hud,
                f"Energy: {energy:.3f} | winΔ: {window_delta:.3f}",
                f"Start/Keep thr: {current_start_threshold:.3f} / {current_keep_threshold:.3f}",
                f"In motion: {'YES' if in_motion else 'NO'}",
                f"Active buffer: {len(active_sequence)} | onset_skip={onset_skip}",
                f"Session: {sess_line}",
                f"Text: {text_buffer if text_buffer else '(empty)'}",
                f"Labels: {', '.join(labels)}",
                "Keys: C clear, SPACE add, Q/ESC quit",
            ])

            cv2.imshow(win, frame)
            key = cv2.waitKey(1) & 0xFF
            if key in (27, ord("q")):
                break
            elif key == ord("c"):
                text_buffer = ""
            elif key == 32:
                if smoothed_pred not in ("NO_HAND", "UNKNOWN", "CAPTURING"):
                    text_buffer = append_token(text_buffer, smoothed_pred)
                    last_append_time = time.time()
        if session_dir is not None and session_segment_records:
            print("\n=== Session feedback (predicted vs correct label) ===")
            print("Enter=accept, type label=correct, skip=ignore")
            saved_feedback = 0
            for rec in session_segment_records:
                pred = str(rec.get("prediction", "UNKNOWN"))
                conf = float(rec.get("confidence", 0.0))
                seg_idx = int(rec.get("segment_index", 0))
                _show_feedback_strip_frames(
                    str(rec.get("mid_frame_path", "")),
                    pred=pred,
                    conf=conf,
                    seg_idx=seg_idx,
                )
                prompt = (
                    f"Segment {seg_idx:04d} | pred={pred} ({conf:.2f}) | "
                    "label (Enter=accept, skip=ignore): "
                )
                user_raw = _input_with_gui_pump(prompt)
                final_label = _normalize_feedback_label(user_raw, fallback=pred)
                if final_label == "SKIP":
                    continue
                seq_path = Path(str(rec.get("tensor_path", "")))
                if not seq_path.exists():
                    continue
                try:
                    data = np.load(seq_path)
                    if "seq" not in data:
                        continue
                    seq = data["seq"].astype(np.float32)
                except Exception:
                    continue
                out_dir = RAW_CUSTOM_DIR / "motion" / final_label
                out_dir.mkdir(parents=True, exist_ok=True)
                sess_name = session_dir.name
                out = out_dir / f"{final_label}_{sess_name}_livefb_{seg_idx:04d}.npz"
                np.savez(str(out), seq=seq)
                append_sample_manifest(
                    {
                        "sample_path": str(out.relative_to(ROOT)).replace("\\", "/"),
                        "task": "motion",
                        "label": final_label,
                        "source": "live_test_feedback",
                        "domain": "custom",
                        "signer_id": "unknown",
                        "session_id": sess_name,
                        "capture_reason": "live_session_feedback",
                        "feature_dim": int(seq.shape[1]) if seq.ndim == 2 else 0,
                        "raw_seq_len": int(len(seq)) if seq.ndim == 2 else 0,
                        "num_hands": MOTION_NUM_HANDS,
                        "predicted_label": pred,
                        "prediction_confidence": conf,
                        "mid_frame_path": str(rec.get("mid_frame_path", "")),
                    },
                    dataset_kind="custom",
                )
                saved_feedback += 1
            print(f"[INFO] Feedback save complete. Added {saved_feedback} corrected samples to dataset/raw_custom/motion.")
            cv2.destroyWindow("Session Feedback Preview")
    finally:
        cap.release()
        cv2.destroyAllWindows()
        if hasattr(detector, "close"):
            detector.close()
        if hasattr(pose_detector, "close"):
            pose_detector.close()


if __name__ == "__main__":
    main()
