"""
Step 1a (low-cost scan): downsample the source video to a fixed FPS
and save every frame to disk together with a timestamp index.

Defaults to 2 FPS (so a 20 min clip = 20 * 60 * 2 = 2,400 frames).

MP4 and similar containers use index-step sampling (every Nth decoded frame).
WebM uses time-based sampling because OpenCV often reports bogus FPS / frame
counts (e.g. 1000 fps), which would otherwise yield only one output frame.

Inputs:
  ai/models/SCVAM2.1/SELECTED_VIDEO.txt   (from test.py)
  or --video <path>

Outputs (under ai/models/SCVAM2.1/output/<stem>_<fps>fps/):
  frames/frame_NNNNNN.png                     (one per sampled frame)
  frames_index.json                           (frame_name -> timestamp / src index)
  <stem>_<fps>fps.mp4                         (downsampled MP4 for review)

Run (from repo root - folder name contains '.', so use the path, not -m):
  python ai/models/SCVAM2.1/preprocess.py
  python ai/models/SCVAM2.1/preprocess.py --fps 2
  python ai/models/SCVAM2.1/preprocess.py --fps 4 --video "C:\\path\\to\\clip.mp4"
  python ai/models/SCVAM2.1/preprocess.py --no-video      # skip the review MP4
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import cv2

SELECTED_NAME = "SELECTED_VIDEO.txt"

# OpenCV-reported FPS above this is treated as invalid (common WebM bug).
_MAX_SANE_REPORTED_FPS = 120.0
_FALLBACK_FPS = 30.0


def _package_dir() -> Path:
    return Path(__file__).resolve().parent


def _read_selected_path() -> Path | None:
    p = _package_dir() / SELECTED_NAME
    if not p.is_file():
        return None
    text = p.read_text(encoding="utf-8").strip()
    return Path(text) if text else None


def _fps_tag(target_fps: float) -> str:
    if abs(target_fps - round(target_fps)) < 1e-3:
        return f"{int(round(target_fps))}fps"
    return f"{target_fps:.2f}fps".replace(".", "p")


def _is_sane_frame_count(n: int) -> bool:
    return 0 < n < 10_000_000


def _is_sane_reported_fps(fps: float) -> bool:
    return 1e-3 < fps <= _MAX_SANE_REPORTED_FPS


def _frame_timestamp_sec(cap: cv2.VideoCapture, src_idx: int, src_fps: float) -> float:
    pos_msec = float(cap.get(cv2.CAP_PROP_POS_MSEC) or 0.0)
    if pos_msec > 0:
        return round(pos_msec / 1000.0, 3)
    if _is_sane_reported_fps(src_fps):
        return round(src_idx / src_fps, 3)
    return round(src_idx / _FALLBACK_FPS, 3)


def _open_video_writer(
    out_mp4: Path,
    effective_target: float,
    width: int,
    height: int,
) -> cv2.VideoWriter:
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(out_mp4), fourcc, effective_target, (width, height))
    if not writer.isOpened():
        raise RuntimeError(f"Could not open VideoWriter for {out_mp4}")
    return writer


def _save_sample(
    *,
    frame,
    frames_dir: Path,
    writer: cv2.VideoWriter | None,
    saved_idx: int,
    src_idx: int,
    ts_sec: float,
    index: list[dict[str, object]],
) -> int:
    saved_idx += 1
    fname = f"frame_{saved_idx:06d}.png"
    cv2.imwrite(str(frames_dir / fname), frame)
    if writer is not None:
        writer.write(frame)
    index.append(
        {
            "frame": fname,
            "src_index": src_idx,
            "ts_sec": ts_sec,
        }
    )
    if saved_idx % 50 == 0:
        print(f"  saved {saved_idx} frames  (src#{src_idx}, t={ts_sec:.2f}s)")
    return saved_idx


def _sample_index_step(
    cap: cv2.VideoCapture,
    *,
    frames_dir: Path,
    writer: cv2.VideoWriter | None,
    src_fps: float,
    src_frames: int,
    step: int,
    index: list[dict[str, object]],
) -> int:
    saved_idx = 0
    src_idx = 0
    log_every = max(1, src_frames // 20) if _is_sane_frame_count(src_frames) else 200

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if src_idx % step == 0:
            ts_sec = _frame_timestamp_sec(cap, src_idx, src_fps)
            saved_idx = _save_sample(
                frame=frame,
                frames_dir=frames_dir,
                writer=writer,
                saved_idx=saved_idx,
                src_idx=src_idx,
                ts_sec=ts_sec,
                index=index,
            )
        src_idx += 1
        if _is_sane_frame_count(src_frames) and src_idx % log_every == 0:
            pct = 100.0 * src_idx / max(1, src_frames)
            print(f"  ... read {src_idx}/{src_frames} src frames  ({pct:.1f}%)")

    return saved_idx


def _sample_time_based(
    cap: cv2.VideoCapture,
    *,
    frames_dir: Path,
    writer: cv2.VideoWriter | None,
    target_fps: float,
    src_fps: float,
    index: list[dict[str, object]],
) -> int:
    interval_sec = 1.0 / target_fps
    next_sample_sec = 0.0
    saved_idx = 0
    src_idx = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        ts_sec = _frame_timestamp_sec(cap, src_idx, src_fps)
        if saved_idx == 0 or ts_sec + 1e-6 >= next_sample_sec:
            saved_idx = _save_sample(
                frame=frame,
                frames_dir=frames_dir,
                writer=writer,
                saved_idx=saved_idx,
                src_idx=src_idx,
                ts_sec=ts_sec,
                index=index,
            )
            if saved_idx == 1:
                next_sample_sec = interval_sec
            else:
                next_sample_sec += interval_sec
        src_idx += 1
        if src_idx % 200 == 0:
            print(f"  ... read {src_idx} src frames  (last t={ts_sec:.2f}s, saved={saved_idx})")

    return saved_idx


def preprocess(
    video_path: Path,
    *,
    target_fps: float = 2.0,
    out_root: Path | None = None,
    write_video: bool = True,
) -> tuple[Path, Path]:
    if not video_path.is_file():
        raise FileNotFoundError(video_path)
    if target_fps <= 0:
        raise ValueError("target_fps must be > 0")

    stem = video_path.stem
    base = out_root if out_root is not None else _package_dir() / "output"
    run_dir = base / f"{stem}_{_fps_tag(target_fps)}"
    frames_dir = run_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")

    reported_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    reported_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if width <= 0 or height <= 0:
        cap.release()
        raise RuntimeError("Could not read frame size from video.")

    use_webm_time_sampling = video_path.suffix.lower() == ".webm"
    if use_webm_time_sampling:
        sampling_mode = "time_based"
        src_fps = reported_fps if _is_sane_reported_fps(reported_fps) else _FALLBACK_FPS
        step = None
        effective_target = target_fps
    else:
        sampling_mode = "index_step"
        src_fps = reported_fps
        if not _is_sane_reported_fps(src_fps):
            src_fps = _FALLBACK_FPS
        step = max(1, int(round(src_fps / target_fps)))
        effective_target = src_fps / step

    src_frames = reported_frames if _is_sane_frame_count(reported_frames) else 0

    writer = None
    out_mp4 = run_dir / f"{stem}_{_fps_tag(target_fps)}.mp4"
    if write_video:
        writer = _open_video_writer(out_mp4, effective_target, width, height)

    print(
        f"src: {video_path}\n"
        f"  size:           {width}x{height}\n"
        f"  reported_fps:   {reported_fps:.3f}\n"
        f"  reported_frames:{reported_frames}\n"
        f"  sampling_mode:  {sampling_mode}\n"
        f"  src_fps_used:   {src_fps:.3f}\n"
        f"  target_fps:     {target_fps}\n"
        f"  step:           {step if step is not None else '(n/a)'}\n"
        f"  effective:      {effective_target:.3f} fps"
    )

    index: list[dict[str, object]] = []
    try:
        if use_webm_time_sampling:
            saved_idx = _sample_time_based(
                cap,
                frames_dir=frames_dir,
                writer=writer,
                target_fps=target_fps,
                src_fps=src_fps,
                index=index,
            )
        else:
            saved_idx = _sample_index_step(
                cap,
                frames_dir=frames_dir,
                writer=writer,
                src_fps=src_fps,
                src_frames=src_frames,
                step=step,
                index=index,
            )
    finally:
        if writer is not None:
            writer.release()
        cap.release()

    index_payload: dict[str, Any] = {
        "video": video_path.as_posix(),
        "stem": stem,
        "sampling_mode": sampling_mode,
        "reported_fps": reported_fps,
        "src_fps": src_fps,
        "src_frame_count": src_frames if src_frames > 0 else reported_frames,
        "target_fps": target_fps,
        "effective_fps": effective_target,
        "width": width,
        "height": height,
        "frame_count": saved_idx,
        "frames": index,
    }
    if step is not None:
        index_payload["step"] = step

    index_path = run_dir / "frames_index.json"
    index_path.write_text(
        json.dumps(index_payload, indent=2),
        encoding="utf-8",
    )

    print(
        f"\nDone. saved {saved_idx} frames to:\n  {frames_dir}\n"
        f"index: {index_path}\n"
        f"video: {out_mp4 if writer is not None else '(skipped)'}"
    )
    return frames_dir, index_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Step 1a: downsample to N fps frames + index.")
    parser.add_argument(
        "--video",
        default="",
        help="Source video path (default: SELECTED_VIDEO.txt from test.py).",
    )
    parser.add_argument(
        "--fps",
        type=float,
        default=2.0,
        help="Target frames-per-second to extract (default 2.0).",
    )
    parser.add_argument(
        "--out",
        default="",
        help="Output root folder (default: ai/models/SCVAM2.1/output).",
    )
    parser.add_argument(
        "--no-video",
        action="store_true",
        help="Skip writing the downsampled MP4 (only frames + index).",
    )
    args = parser.parse_args()

    if args.video:
        video_path = Path(args.video).expanduser().resolve()
    else:
        sel = _read_selected_path()
        if sel is None:
            print(
                "No --video and no SELECTED_VIDEO.txt.\n"
                "Run first: python ai/models/SCVAM2.1/test.py"
            )
            return 1
        video_path = sel

    out_root = Path(args.out).expanduser().resolve() if args.out else None

    try:
        preprocess(
            video_path,
            target_fps=max(0.1, args.fps),
            out_root=out_root,
            write_video=not args.no_video,
        )
    except (FileNotFoundError, RuntimeError, ValueError) as e:
        print(f"[ERROR] {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
