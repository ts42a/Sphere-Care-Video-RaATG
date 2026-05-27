"""
Step 1a (low-cost scan): downsample the source video to a fixed FPS
and save every frame to disk together with a timestamp index.

Defaults to 2 FPS (so a 20 min clip = 20 * 60 * 2 = 2,400 frames).

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

import cv2

SELECTED_NAME = "SELECTED_VIDEO.txt"


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

    src_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    if src_fps <= 1e-3:
        src_fps = 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    src_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if width <= 0 or height <= 0:
        cap.release()
        raise RuntimeError("Could not read frame size from video.")

    # Approximately one output frame every src_fps/target input frames.
    step = max(1, int(round(src_fps / target_fps)))
    effective_target = src_fps / step

    writer = None
    out_mp4 = run_dir / f"{stem}_{_fps_tag(target_fps)}.mp4"
    if write_video:
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(out_mp4), fourcc, effective_target, (width, height))
        if not writer.isOpened():
            cap.release()
            raise RuntimeError(f"Could not open VideoWriter for {out_mp4}")

    print(
        f"src: {video_path}\n"
        f"  size:        {width}x{height}\n"
        f"  src_fps:     {src_fps:.3f}\n"
        f"  src_frames:  {src_frames}\n"
        f"  target_fps:  {target_fps}\n"
        f"  step:        {step}\n"
        f"  effective:   {effective_target:.3f} fps"
    )

    index: list[dict[str, object]] = []
    saved_idx = 0
    src_idx = 0
    log_every = max(1, src_frames // 20) if src_frames > 0 else 200

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if src_idx % step == 0:
                saved_idx += 1
                fname = f"frame_{saved_idx:06d}.png"
                cv2.imwrite(str(frames_dir / fname), frame)
                if writer is not None:
                    writer.write(frame)
                ts_sec = round(src_idx / src_fps, 3)
                index.append(
                    {
                        "frame": fname,
                        "src_index": src_idx,
                        "ts_sec": ts_sec,
                    }
                )
                if saved_idx % 50 == 0:
                    print(f"  saved {saved_idx} frames  (src#{src_idx}, t={ts_sec:.2f}s)")
            src_idx += 1
            if src_frames > 0 and src_idx % log_every == 0:
                pct = 100.0 * src_idx / max(1, src_frames)
                print(f"  ... read {src_idx}/{src_frames} src frames  ({pct:.1f}%)")
    finally:
        if writer is not None:
            writer.release()
        cap.release()

    index_path = run_dir / "frames_index.json"
    index_path.write_text(
        json.dumps(
            {
                "video": video_path.as_posix(),
                "stem": stem,
                "src_fps": src_fps,
                "src_frame_count": src_frames,
                "target_fps": target_fps,
                "effective_fps": effective_target,
                "step": step,
                "width": width,
                "height": height,
                "frame_count": saved_idx,
                "frames": index,
            },
            indent=2,
        ),
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
