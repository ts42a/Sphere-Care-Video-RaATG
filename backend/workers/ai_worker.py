"""
AI pipeline worker — run separately from uvicorn.

  python -m backend.workers.ai_worker file --video clip.mp4 --admin-id 1 \\
    --resident-name "Dorothy Miller" --resident-id 1 --camera-id 1 --detector mock --no-llm

  python -m backend.workers.ai_worker summarize --record-id 1 --video clip.mp4

  python -m backend.workers.ai_worker rtsp --url rtsp://... --admin-id 1 --camera-id 1
"""

from __future__ import annotations

import argparse
import os
import sys


def _bootstrap_path() -> None:
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    if root not in sys.path:
        sys.path.insert(0, root)


def cmd_file(args: argparse.Namespace) -> int:
    _bootstrap_path()
    from backend.db.session import SessionLocal
    from backend.services.ai.vision.pipeline import run_detection_pipeline
    from backend.services.ai.vision.video_ingest import iter_video_frames

    if not os.path.isfile(args.video):
        print("Video file not found:", args.video)
        return 1

    db = SessionLocal()
    try:
        ids = run_detection_pipeline(
            db,
            admin_id=args.admin_id,
            resident_name=args.resident_name,
            resident_id=args.resident_id,
            camera_id=args.camera_id,
            frame_iter=iter_video_frames(args.video),
            detector_kind=args.detector,
            use_llm=not args.no_llm,
            model_label=args.model_label,
        )
        print("Created flag, insight pairs (id pairs):", ids)
        return 0
    finally:
        db.close()


def cmd_summarize(args: argparse.Namespace) -> int:
    _bootstrap_path()
    from backend.db.session import SessionLocal
    from backend.services.ai.vision.pipeline import summarize_video_for_record

    if not os.path.isfile(args.video):
        print("Video file not found:", args.video)
        return 1

    db = SessionLocal()
    try:
        text = summarize_video_for_record(
            db,
            record_id=args.record_id,
            video_path=args.video,
            segment_seconds=args.segment_seconds,
        )
        print("Updated record", args.record_id, "ai_summary length:", len(text or ""))
        print((text or "")[:2000])
        return 0
    except ValueError as e:
        print(e)
        return 1
    finally:
        db.close()


def cmd_rtsp(args: argparse.Namespace) -> int:
    _bootstrap_path()
    from backend.db.session import SessionLocal
    from backend.services.ai.vision.pipeline import stream_pipeline
    from backend.services.ai.vision.rtsp_ingest import iter_rtsp_frames

    db = SessionLocal()
    try:
        ids = stream_pipeline(
            db,
            admin_id=args.admin_id,
            resident_name=args.resident_name,
            resident_id=args.resident_id,
            camera_id=args.camera_id,
            frame_iter=iter_rtsp_frames(args.url, max_fps=args.max_fps, max_width=args.width),
            detector_kind=args.detector,
            use_llm=not args.no_llm,
            max_frames=args.max_frames,
            window=args.window,
        )
        print("Created flag, insight pairs:", ids)
        return 0
    finally:
        db.close()


def main() -> int:
    p = argparse.ArgumentParser(description="Sphere Care AI worker")
    sub = p.add_subparsers(dest="command", required=True)

    f = sub.add_parser("file", help="Process a video file")
    f.add_argument("--video", required=True)
    f.add_argument("--admin-id", type=int, default=int(os.getenv("DEFAULT_ADMIN_ID", "1")))
    f.add_argument("--resident-name", default="Demo Resident")
    f.add_argument("--resident-id", type=int, default=None)
    f.add_argument("--camera-id", type=int, default=None)
    f.add_argument("--detector", choices=("mock", "yolo"), default="mock")
    f.add_argument("--no-llm", action="store_true")
    f.add_argument("--model-label", default="sphere-care-ai-worker")
    f.set_defaults(func=cmd_file)

    s = sub.add_parser("summarize", help="Fill Record.ai_summary from video timeline")
    s.add_argument("--record-id", type=int, required=True)
    s.add_argument("--video", required=True)
    s.add_argument("--segment-seconds", type=float, default=30.0)
    s.set_defaults(func=cmd_summarize)

    r = sub.add_parser("rtsp", help="Stream from RTSP / URL with FPS cap")
    r.add_argument("--url", required=True)
    r.add_argument("--admin-id", type=int, default=int(os.getenv("DEFAULT_ADMIN_ID", "1")))
    r.add_argument("--resident-name", default="Demo Resident")
    r.add_argument("--resident-id", type=int, default=None)
    r.add_argument("--camera-id", type=int, default=None)
    r.add_argument("--detector", choices=("mock", "yolo"), default="mock")
    r.add_argument("--no-llm", action="store_true")
    r.add_argument("--max-frames", type=int, default=500)
    r.add_argument("--max-fps", type=float, default=None)
    r.add_argument("--width", type=int, default=None)
    r.add_argument("--window", type=int, default=24)
    r.set_defaults(func=cmd_rtsp)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
