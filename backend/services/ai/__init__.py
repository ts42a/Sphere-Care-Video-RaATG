"""AI services: shared LLM helpers, ``vision`` (CCTV) pipeline, ``transcript`` (speech — placeholder)."""

from backend.services.ai.vision import (
    iter_video_frames,
    resize_frame,
    run_detection_pipeline,
    stream_pipeline,
    summarize_video_for_record,
)

__all__ = [
    "run_detection_pipeline",
    "stream_pipeline",
    "summarize_video_for_record",
    "iter_video_frames",
    "resize_frame",
]
