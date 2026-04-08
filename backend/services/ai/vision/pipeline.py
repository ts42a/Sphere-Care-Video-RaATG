from __future__ import annotations

from typing import Iterable, List, Optional, Set, Tuple

import cv2
import numpy as np
from sqlalchemy.orm import Session

from backend import models
from backend.core import config as app_config

from backend.services.ai.llm_client import summarize_timeline_text

from backend.services.ai.vision.detectors import Detector, build_detector
from backend.services.ai.vision.event_schema import FrameAnalysis
from backend.services.ai.vision.persistence import create_flag_and_insight
from backend.services.ai.vision.rules import evaluate_frames
from backend.services.ai.vision.video_ingest import VideoFrame, iter_video_frames, resize_frame
from backend.services.ai.vision.zones import load_zone_defs, zones_for_bbox


def _assign_zones(camera_id: int, fa: FrameAnalysis) -> FrameAnalysis:
    zdata = load_zone_defs()
    hits: Set[str] = set()
    for d in fa.detections:
        for z in zones_for_bbox(camera_id, d, zdata):
            hits.add(z)
    fa.zone_hits = sorted(hits)
    return fa


def _dedupe_key(hit) -> str:
    return f"{hit.event_type}|{hit.severity}"


def run_detection_pipeline(
    db: Session,
    *,
    admin_id: int,
    resident_name: str,
    resident_id: Optional[int],
    camera_id: Optional[int],
    frame_iter: Iterable[VideoFrame],
    detector: Optional[Detector] = None,
    detector_kind: str = "mock",
    use_llm: bool = True,
    model_label: str = "sphere-care-ai",
) -> List[Tuple[int, int]]:
    if not app_config.AI_PIPELINE_ENABLED:
        return []

    det = detector or build_detector(detector_kind)
    analyses: List[FrameAnalysis] = []
    prev_gray: Optional[np.ndarray] = None

    for vf in frame_iter:
        small, _ = resize_frame(vf.bgr, max_w=app_config.RTSP_FRAME_WIDTH)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        motion = 0.0
        if prev_gray is not None:
            motion = float(np.mean(cv2.absdiff(gray, prev_gray)))
        prev_gray = gray

        fa = FrameAnalysis(
            frame_index=vf.index,
            timestamp_sec=vf.timestamp_sec,
            camera_id=camera_id,
            motion_score=motion,
        )
        fa = det.analyze(small, fa)
        fa = _assign_zones(camera_id or 0, fa)
        analyses.append(fa)

    hits = evaluate_frames(analyses)
    seen: Set[str] = set()
    out: List[Tuple[int, int]] = []
    for hit in hits:
        k = _dedupe_key(hit)
        if k in seen:
            continue
        seen.add(k)
        flag, ins = create_flag_and_insight(
            db,
            admin_id=admin_id,
            resident_name=resident_name,
            resident_id=resident_id,
            camera_id=camera_id,
            hit=hit,
            model_label=model_label,
            use_llm=use_llm,
        )
        out.append((flag.id, ins.id))
    return out


def summarize_video_for_record(
    db: Session,
    *,
    record_id: int,
    video_path: str,
    segment_seconds: float = 30.0,
) -> str:
    rec = db.query(models.Record).filter(models.Record.id == record_id).first()
    if not rec:
        raise ValueError("record not found")

    lines: List[str] = []
    cap_chunk_start = 0.0
    last_t = 0.0
    motion_accum = 0.0
    n_frames = 0
    prev_gray = None

    for vf in iter_video_frames(video_path, max_fps=0.5):
        gray = cv2.cvtColor(vf.bgr, cv2.COLOR_BGR2GRAY)
        m = 0.0
        if prev_gray is not None:
            m = float(np.mean(cv2.absdiff(gray, prev_gray)))
        prev_gray = gray
        motion_accum += m
        n_frames += 1
        last_t = vf.timestamp_sec
        if vf.timestamp_sec - cap_chunk_start >= segment_seconds:
            avg = motion_accum / max(n_frames, 1)
            lines.append(
                f"{cap_chunk_start:.0f}s–{last_t:.0f}s: avg_motion={avg:.2f} samples={n_frames}"
            )
            cap_chunk_start = last_t
            motion_accum = 0.0
            n_frames = 0

    if n_frames:
        avg = motion_accum / max(n_frames, 1)
        lines.append(f"{cap_chunk_start:.0f}s–{last_t:.0f}s: avg_motion={avg:.2f} samples={n_frames}")

    summary = summarize_timeline_text(lines)
    rec.ai_summary = summary
    db.commit()
    db.refresh(rec)
    return summary


def stream_pipeline(
    db: Session,
    *,
    admin_id: int,
    resident_name: str,
    resident_id: Optional[int],
    camera_id: Optional[int],
    frame_iter: Iterable[VideoFrame],
    detector_kind: str = "mock",
    use_llm: bool = True,
    max_frames: int = 500,
    window: int = 24,
) -> List[Tuple[int, int]]:
    det = build_detector(detector_kind)
    buf: List[FrameAnalysis] = []
    out: List[Tuple[int, int]] = []
    seen: Set[str] = set()
    prev_gray = None

    for i, vf in enumerate(frame_iter):
        if i >= max_frames:
            break
        small, _ = resize_frame(vf.bgr, max_w=app_config.RTSP_FRAME_WIDTH)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        motion = 0.0
        if prev_gray is not None:
            motion = float(np.mean(cv2.absdiff(gray, prev_gray)))
        prev_gray = gray

        fa = FrameAnalysis(
            frame_index=vf.index,
            timestamp_sec=vf.timestamp_sec,
            camera_id=camera_id,
            motion_score=motion,
        )
        fa = det.analyze(small, fa)
        fa = _assign_zones(camera_id or 0, fa)
        buf.append(fa)
        if len(buf) > window:
            buf.pop(0)
        if len(buf) < max(4, window // 2):
            continue
        hits = evaluate_frames(buf)
        for hit in hits:
            k = _dedupe_key(hit)
            if k in seen:
                continue
            seen.add(k)
            flag, ins = create_flag_and_insight(
                db,
                admin_id=admin_id,
                resident_name=resident_name,
                resident_id=resident_id,
                camera_id=camera_id,
                hit=hit,
                model_label="sphere-care-ai-rtsp",
                use_llm=use_llm,
            )
            out.append((flag.id, ins.id))
    return out
