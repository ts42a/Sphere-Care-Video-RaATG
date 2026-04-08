"""CCTV / video vision pipeline: ingest, detection, rules, flags + insights."""

from backend.services.ai.vision.pipeline import (
    run_detection_pipeline,
    stream_pipeline,
    summarize_video_for_record,
)
from backend.services.ai.vision.video_ingest import VideoFrame, iter_video_frames, resize_frame

__all__ = [
    "run_detection_pipeline",
    "stream_pipeline",
    "summarize_video_for_record",
    "VideoFrame",
    "iter_video_frames",
    "resize_frame",
]
