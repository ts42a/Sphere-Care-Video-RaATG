"""
Compare a saved motion .npz (training-time layout) to a live segment from the webcam
using the same feature extraction and segmentation rules as test_motion.py.

Usage:
  py compare_motion_live_npz.py --npz dataset/raw_custom/motion/YES/YES_....npz
  py compare_motion_live_npz.py --npz path/to/sample.npz --live

Reference-only prints stats + model prediction. With --live, perform a sign; when the
segment ends (same idle / max-frames rules as test_motion), stats print again and
differences vs the reference are shown. Press Q/ESC to quit.
"""
from __future__ import annotations

import argparse
import json
from collections import deque
from pathlib import Path

import cv2
import numpy as np

from dataset_builder import (
    MOTION_BURST_END_IDLE_FRAMES,
    MOTION_IDLE_HISTORY,
    MOTION_LONG_MAX_FRAMES,
    MOTION_LIVE_MIN_FRAMES_BEFORE_IDLE,
    MOTION_LIVE_ONSET_SKIP_FRAMES,
    MOTION_MAX_FRAMES_PER_SAMPLE,
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
)
from motion_gru import _fixed_seq_and_length, load_motion_gru_checkpoint, predict_sequence_probs

try:
    import mediapipe as mp
except ImportError:
    raise SystemExit("Run: py -m pip install mediapipe opencv-python numpy torch")

ROOT = Path(__file__).resolve().parent
ARTIFACTS_DIR = ROOT / "artifacts" / "gesture"
MODEL_PATH = ARTIFACTS_DIR / "motion_model.pt"
LABELS_PATH = ARTIFACTS_DIR / "motion_labels.json"


def _pose_tracks_ok(pose_lms) -> bool:
    if pose_lms is None:
        return False
    try:
        return len(pose_lms) >= max(MOTION_POSE_LANDMARKS) + 1
    except TypeError:
        return False


def summarize_fixed(fixed: np.ndarray, valid_len: int) -> dict[str, float]:
    """Stats on the first valid_len rows (non-padded motion), plus full-tensor MSE hint."""
    v = int(max(1, min(valid_len, fixed.shape[0])))
    part = fixed[:v].astype(np.float32)
    frame_norms = np.linalg.norm(part, axis=1)
    if len(part) >= 2:
        deltas = np.diff(part, axis=0)
        step_l2 = float(np.mean(np.linalg.norm(deltas, axis=1)))
    else:
        step_l2 = 0.0
    return {
        "frames_used": float(v),
        "mean_frame_L2": float(np.mean(frame_norms)),
        "std_frame_L2": float(np.std(frame_norms)),
        "mean_step_L2": step_l2,
        "vec_mean": float(np.mean(part)),
        "vec_std": float(np.std(part)),
    }


def compare_fixed(ref: np.ndarray, live: np.ndarray) -> dict[str, float]:
    """Both (seq_len, D); compare full padded tensors (matches what GRU sees with padding)."""
    r = ref.astype(np.float32).ravel()
    l = live.astype(np.float32).ravel()
    mse = float(np.mean((r - l) ** 2))
    rn = np.linalg.norm(r)
    ln = np.linalg.norm(l)
    cos = float(np.dot(r, l) / (rn * ln + 1e-8))
    return {"mse_padded_flat": mse, "cosine_padded_flat": cos, "norm_ref": float(rn), "norm_live": float(ln)}


def print_block(title: str, stats: dict[str, float], probs: np.ndarray | None, labels: list[str]) -> None:
    print(f"\n--- {title} ---")
    for k in sorted(stats.keys()):
        print(f"  {k}: {stats[k]:.6f}")
    if probs is not None and labels:
        order = np.argsort(-probs)[:5]
        print("  model top-5:")
        for i in order:
            print(f"    {labels[int(i)]}: {float(probs[int(i)]):.4f}")


def load_reference(npz_path: Path, seq_len: int) -> tuple[np.ndarray, int, np.ndarray]:
    data = np.load(npz_path)
    if "seq" not in data:
        raise SystemExit(f"No 'seq' array in {npz_path}")
    seq = data["seq"].astype(np.float32)
    fixed, valid_len = _fixed_seq_and_length(seq, seq_len)
    return fixed, int(valid_len), seq


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare saved motion .npz vs live webcam segment.")
    parser.add_argument("--npz", type=Path, required=True, help="Path to reference .npz (must contain 'seq').")
    parser.add_argument("--live", action="store_true", help="Open webcam and compare after each segment ends.")
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument(
        "--onset-skip",
        type=int,
        default=-1,
        help="Frames to drop from start of each live segment (-1 = MOTION_LIVE_ONSET_SKIP_FRAMES).",
    )
    args = parser.parse_args()

    onset_skip = (
        int(MOTION_LIVE_ONSET_SKIP_FRAMES) if args.onset_skip < 0 else max(0, int(args.onset_skip))
    )

    if not MODEL_PATH.exists() or not LABELS_PATH.exists():
        raise SystemExit(f"Train motion first; missing {MODEL_PATH} or {LABELS_PATH}")

    bundle = load_motion_gru_checkpoint(MODEL_PATH)
    meta = json.loads(LABELS_PATH.read_text(encoding="utf-8"))
    labels = list(meta.get("labels", []))
    seq_len = int(bundle.get("seq_len", meta.get("seq_len", 10)))
    feature_dim = int(meta.get("feature_dim", bundle.get("feature_dim", 147)))

    npz_path = args.npz.resolve()
    if not npz_path.exists():
        raise SystemExit(f"Not found: {npz_path}")

    ref_fixed, ref_valid, raw_seq = load_reference(npz_path, seq_len)
    ref_stats = summarize_fixed(ref_fixed, ref_valid)
    ref_probs = predict_sequence_probs(bundle, raw_seq)
    print_block(f"REFERENCE {npz_path.name}", ref_stats, ref_probs, labels)
    print(f"(raw seq shape {raw_seq.shape} -> fixed {ref_fixed.shape}, valid_len={ref_valid})")

    if not args.live:
        print("\nAdd --live to capture from webcam and compare after each sign segment.")
        return

    detector = create_detector(
        MOTION_NUM_HANDS,
        min_hand_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    pose_detector = create_pose_detector()
    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise SystemExit(f"Could not open camera {args.camera}")

    win = "Compare motion: sign, release to end segment (Q/ESC quit)"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    prebuffer: deque[np.ndarray] = deque(maxlen=MOTION_PREBUFFER_FRAMES)
    start_window: deque[np.ndarray] = deque(maxlen=MOTION_START_WINDOW)
    idle_energies: deque[float] = deque(maxlen=MOTION_IDLE_HISTORY)
    active_sequence: list[np.ndarray] = []
    last_vec: np.ndarray | None = None
    in_motion = False
    active_streak = 0
    idle_streak = 0
    segment_idx = 0

    print("\nLive mode: same segmentation as test_motion.py. Sign, then hold still to end segment.")

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
            pose_res = pose_detector.detect(mp_image)
            pose_lms = pose_res.pose_landmarks[0] if getattr(pose_res, "pose_landmarks", None) else None
            pose_ok = _pose_tracks_ok(pose_lms)
            if pose_ok and pose_lms is not None:
                draw_motion_pose_overlay(frame, pose_lms)
            n_hands = len(res.hand_landmarks) if res.hand_landmarks else 0
            if res.hand_landmarks:
                draw_hand_landmarks(frame, res.hand_landmarks)
            cv2.putText(
                frame,
                f"Hands {n_hands}/{MOTION_NUM_HANDS} | Body {'OK' if pose_ok else 'weak'}",
                (10, 28),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (0, 255, 255),
                2,
                cv2.LINE_AA,
            )

            status = "idle"
            current_start_threshold, current_keep_threshold = adaptive_motion_thresholds(idle_energies)
            if res.hand_landmarks:
                vec = extract_motion_features(res.hand_landmarks, pose_lms)
                if vec.shape[0] > feature_dim:
                    vec = vec[:feature_dim]
                elif vec.shape[0] < feature_dim:
                    vec = np.concatenate([vec, np.zeros(feature_dim - vec.shape[0], dtype=np.float32)], axis=0)
                prebuffer.append(vec)
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
                    started_now = True

                if in_motion:
                    if not started_now:
                        active_sequence.append(vec)
                    status = f"CAPTURING ({len(active_sequence)} frames)"
                    flush = False
                    if len(active_sequence) >= MOTION_LONG_MAX_FRAMES:
                        flush = True
                    elif idle_streak >= MOTION_BURST_END_IDLE_FRAMES:
                        flush = True
                    if flush:
                        segment_idx += 1
                        seq_arr = np.array(active_sequence[:MOTION_MAX_FRAMES_PER_SAMPLE], dtype=np.float32)
                        if onset_skip > 0 and seq_arr.shape[0] > onset_skip:
                            seq_arr = seq_arr[onset_skip:].astype(np.float32)
                        live_fixed, live_valid = _fixed_seq_and_length(seq_arr, seq_len)
                        live_stats = summarize_fixed(live_fixed, live_valid)
                        live_probs = predict_sequence_probs(bundle, seq_arr)
                        diff = compare_fixed(ref_fixed, live_fixed)
                        print_block(f"LIVE segment #{segment_idx}", live_stats, live_probs, labels)
                        print_block("DIFF (ref vs live padded tensor)", diff, None, [])
                        active_sequence = []
                        in_motion = False
                        active_streak = 0
                        idle_streak = 0
                    last_vec = vec
                else:
                    last_vec = vec
            else:
                if in_motion:
                    idle_streak += 1
                    if idle_streak >= MOTION_BURST_END_IDLE_FRAMES:
                        segment_idx += 1
                        seq_arr = np.array(active_sequence[:MOTION_MAX_FRAMES_PER_SAMPLE], dtype=np.float32)
                        if onset_skip > 0 and seq_arr.shape[0] > onset_skip:
                            seq_arr = seq_arr[onset_skip:].astype(np.float32)
                        live_fixed, live_valid = _fixed_seq_and_length(seq_arr, seq_len)
                        live_stats = summarize_fixed(live_fixed, live_valid)
                        live_probs = predict_sequence_probs(bundle, seq_arr)
                        diff = compare_fixed(ref_fixed, live_fixed)
                        print_block(f"LIVE segment #{segment_idx} (hands lost)", live_stats, live_probs, labels)
                        print_block("DIFF (ref vs live padded tensor)", diff, None, [])
                        active_sequence = []
                        in_motion = False
                        active_streak = 0
                        idle_streak = 0
                last_vec = None

            cv2.putText(
                frame,
                f"{status} | seg={segment_idx} | skip={onset_skip} | Q=quit",
                (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 0),
                2,
            )
            cv2.imshow(win, frame)
            key = cv2.waitKey(1) & 0xFF
            if key in (27, ord("q")):
                break
    finally:
        cap.release()
        cv2.destroyAllWindows()
        if hasattr(detector, "close"):
            detector.close()
        if hasattr(pose_detector, "close"):
            pose_detector.close()


if __name__ == "__main__":
    main()
