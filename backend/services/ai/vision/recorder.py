"""
Continuous recording service.

Records an RTSP (or file) stream into fixed-duration clips written to a
private directory that is only accessible by the backend process.  After
each clip is written, the existing AI pipeline runs on it.  When the
session ends (or is stopped) all clips are merged into one final MP4 and
the clip scratch folder is cleaned up.

Folder layout (relative to backend root):
  .recordings/
    clips/<session_id>/  ← private, chmod 700, only the process can read
      0001.mp4
      0002.mp4
      ...
    merged/
      <session_id>.mp4   ← final output kept after analysis

Usage:
  manager = RecordingManager()
  session_id = await manager.start(camera_id=3, stream_url="rtsp://…",
                                   admin_id=1, resident_id=5,
                                   resident_name="John Smith")
  await manager.stop(session_id)
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import stat
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import cv2

from backend.core import config as app_config

log = logging.getLogger("sphere_care.recorder")

# ---------------------------------------------------------------------------
# Storage roots
# ---------------------------------------------------------------------------
_BACKEND_ROOT = Path(__file__).resolve().parents[3]   # …/backend
_RECORDINGS_ROOT = _BACKEND_ROOT / ".recordings"
_CLIPS_ROOT = _RECORDINGS_ROOT / "clips"
_MERGED_ROOT = _RECORDINGS_ROOT / "merged"

CLIP_DURATION_SEC: float = app_config.RECORDING_CLIP_SECONDS
CLIP_FPS: float = app_config.RECORDING_CLIP_FPS
CLIP_WIDTH: int = app_config.RECORDING_CLIP_WIDTH
CLIP_HEIGHT: int = app_config.RECORDING_CLIP_HEIGHT


def _init_storage() -> None:
    """Create private storage directories with restricted permissions."""
    for d in (_CLIPS_ROOT, _MERGED_ROOT):
        d.mkdir(parents=True, exist_ok=True)
    # Owner-only: rwx------
    _RECORDINGS_ROOT.chmod(stat.S_IRWXU)
    _CLIPS_ROOT.chmod(stat.S_IRWXU)
    _MERGED_ROOT.chmod(stat.S_IRWXU)


_init_storage()


# ---------------------------------------------------------------------------
# Session state
# ---------------------------------------------------------------------------
@dataclass
class RecordingSession:
    session_id: str
    camera_id: int
    stream_url: str
    admin_id: int
    resident_id: Optional[int]
    resident_name: str
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    clips: List[Path] = field(default_factory=list)
    merged_path: Optional[Path] = None
    analysis_results: List[List] = field(default_factory=list)   # per-clip [(flag_id, ins_id)]
    stopped: bool = False
    _task: Optional[asyncio.Task] = field(default=None, repr=False)

    @property
    def clip_dir(self) -> Path:
        return _CLIPS_ROOT / self.session_id

    @property
    def status(self) -> str:
        if self.stopped and self.merged_path:
            return "completed"
        if self.stopped:
            return "stopped"
        return "recording"


# ---------------------------------------------------------------------------
# Core recording loop (runs in a thread via asyncio.to_thread)
# ---------------------------------------------------------------------------
def _write_clips(
    session: RecordingSession,
    stop_event: asyncio.Event,
) -> None:
    """
    Open the camera stream, segment it into fixed-duration MP4 clips, and
    write them to the session's private clip directory.

    Runs synchronously inside asyncio.to_thread().
    """
    session.clip_dir.mkdir(parents=True, exist_ok=True)
    session.clip_dir.chmod(stat.S_IRWXU)

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    clip_num = 0

    # Device index (webcam) vs network/file URL
    is_device = session.stream_url.lstrip("-").isdigit()
    dev_index = int(session.stream_url) if is_device else None

    def _open_cap():
        if is_device:
            import sys
            # DirectShow works reliably on Windows; MSMF has format-negotiation bugs
            backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_V4L2
            return cv2.VideoCapture(dev_index, backend)
        return cv2.VideoCapture(session.stream_url, cv2.CAP_FFMPEG)

    cap = _open_cap()
    if not cap.isOpened():
        log.error("[recorder] cannot open stream %s", session.stream_url)
        return

    log.info("[recorder] session=%s stream opened (device=%s)", session.session_id, is_device)

    def _new_writer(n: int):
        p = session.clip_dir / f"{n:04d}.mp4"
        w = cv2.VideoWriter(str(p), fourcc, CLIP_FPS, (CLIP_WIDTH, CLIP_HEIGHT))
        return w, p

    writer, current_path = _new_writer(clip_num)
    clip_start = time.monotonic()
    frames_written = 0
    consecutive_failures = 0
    # Throttle live cameras to CLIP_FPS so clips aren't huge
    frame_interval = 1.0 / CLIP_FPS
    last_write_t = time.monotonic()

    try:
        while not stop_event.is_set():
            ok, frame = cap.read()
            if not ok:
                consecutive_failures += 1
                if consecutive_failures > 10:
                    log.warning("[recorder] stream ended or too many failures, stopping")
                    break
                log.warning("[recorder] stream read failed (%d/10), retrying…", consecutive_failures)
                time.sleep(0.5)
                cap.release()
                cap = _open_cap()
                continue
            consecutive_failures = 0

            # Throttle: skip frame if we wrote one too recently
            now = time.monotonic()
            if now - last_write_t < frame_interval:
                continue
            last_write_t = now

            resized = cv2.resize(frame, (CLIP_WIDTH, CLIP_HEIGHT))
            writer.write(resized)
            frames_written += 1

            elapsed = time.monotonic() - clip_start
            if elapsed >= CLIP_DURATION_SEC:
                writer.release()
                if frames_written > 0:
                    session.clips.append(current_path)
                    log.info("[recorder] clip saved: %s (%d frames)", current_path.name, frames_written)
                clip_num += 1
                writer, current_path = _new_writer(clip_num)
                clip_start = time.monotonic()
                frames_written = 0
    finally:
        writer.release()
        cap.release()
        # Save the last partial clip if it has any content
        if frames_written > 0:
            session.clips.append(current_path)
            log.info("[recorder] final partial clip: %s", current_path.name)


# ---------------------------------------------------------------------------
# Per-clip AI analysis
# ---------------------------------------------------------------------------
def _analyze_clip(session: RecordingSession, clip_path: Path) -> List:
    """Run the AI detection pipeline on one clip and return (flag_id, ins_id) pairs."""
    from backend.db.session import SessionLocal
    from backend.services.ai.vision.pipeline import run_detection_pipeline
    from backend.services.ai.vision.video_ingest import iter_video_frames

    db = SessionLocal()
    try:
        results = run_detection_pipeline(
            db,
            admin_id=session.admin_id,
            resident_name=session.resident_name,
            resident_id=session.resident_id,
            camera_id=session.camera_id,
            frame_iter=iter_video_frames(str(clip_path), max_fps=2.0),
            detector_kind="mock",
            use_llm=getattr(app_config, "AI_USE_LLM", True),
            model_label="sphere-care-recorder",
        )
        return results
    except Exception as exc:
        log.exception("[recorder] analysis failed for %s: %s", clip_path.name, exc)
        return []
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Clip merger
# ---------------------------------------------------------------------------
def _merge_clips(session: RecordingSession) -> Optional[Path]:
    """
    Concatenate all clips into a single MP4 using FFmpeg (preferred) or
    OpenCV as a fallback.  Returns the path to the merged file, or None.
    """
    if not session.clips:
        log.warning("[recorder] no clips to merge for session %s", session.session_id)
        return None

    merged_path = _MERGED_ROOT / f"{session.session_id}.mp4"
    _MERGED_ROOT.chmod(stat.S_IRWXU)

    # --- FFmpeg concat (fast, lossless copy) --------------------------------
    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin:
        list_file = session.clip_dir / "concat.txt"
        with list_file.open("w") as fh:
            for clip in session.clips:
                fh.write(f"file '{clip.as_posix()}'\n")
        cmd = [
            ffmpeg_bin, "-y", "-f", "concat", "-safe", "0",
            "-i", str(list_file),
            "-c", "copy",
            str(merged_path),
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=300)
            log.info("[recorder] merged %d clips → %s", len(session.clips), merged_path.name)
            return merged_path
        except Exception as exc:
            log.warning("[recorder] ffmpeg merge failed (%s), falling back to OpenCV", exc)

    # --- OpenCV fallback (re-encodes) ---------------------------------------
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(merged_path), fourcc, CLIP_FPS, (CLIP_WIDTH, CLIP_HEIGHT))
    try:
        for clip in session.clips:
            cap = cv2.VideoCapture(str(clip))
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                resized = cv2.resize(frame, (CLIP_WIDTH, CLIP_HEIGHT))
                writer.write(resized)
            cap.release()
    finally:
        writer.release()

    log.info("[recorder] merged (opencv) %d clips → %s", len(session.clips), merged_path.name)
    return merged_path


# ---------------------------------------------------------------------------
# High-level async recording task
# ---------------------------------------------------------------------------
async def _run_session(session: RecordingSession, stop_event: asyncio.Event) -> None:
    """
    Full lifecycle:
      1. Record clips (blocking, runs in thread)
      2. Analyze each clip with the AI pipeline
      3. Merge clips → final MP4
      4. Clean up the clip scratch folder
    """
    # Phase 1 — record
    try:
        await asyncio.to_thread(_write_clips, session, stop_event)
    except Exception:
        log.exception("[recorder] recording thread crashed for session %s", session.session_id)

    session.stopped = True
    log.info("[recorder] recording stopped — %d clips collected", len(session.clips))

    # Phase 2 — analyze clips
    for clip_path in session.clips:
        log.info("[recorder] analysing %s …", clip_path.name)
        results = await asyncio.to_thread(_analyze_clip, session, clip_path)
        session.analysis_results.append(results)
        log.info("[recorder] %s → %d events", clip_path.name, len(results))

    # Phase 3 — merge
    merged = await asyncio.to_thread(_merge_clips, session)
    session.merged_path = merged

    # Phase 4 — clean scratch clips
    try:
        shutil.rmtree(session.clip_dir, ignore_errors=True)
        log.info("[recorder] scratch clips removed for session %s", session.session_id)
    except Exception as exc:
        log.warning("[recorder] could not remove clip dir: %s", exc)

    log.info(
        "[recorder] session %s complete — merged=%s events=%d",
        session.session_id,
        merged.name if merged else "none",
        sum(len(r) for r in session.analysis_results),
    )


# ---------------------------------------------------------------------------
# Public manager
# ---------------------------------------------------------------------------
class RecordingManager:
    """Singleton-style manager; create one instance per process."""

    def __init__(self) -> None:
        self._sessions: Dict[str, RecordingSession] = {}
        self._stop_events: Dict[str, asyncio.Event] = {}

    async def start(
        self,
        *,
        camera_id: int,
        stream_url: str,
        admin_id: int,
        resident_id: Optional[int] = None,
        resident_name: str = "Unknown",
    ) -> str:
        """Start a new recording session.  Returns the session_id."""
        session_id = str(uuid.uuid4())
        session = RecordingSession(
            session_id=session_id,
            camera_id=camera_id,
            stream_url=stream_url,
            admin_id=admin_id,
            resident_id=resident_id,
            resident_name=resident_name,
        )
        stop_event = asyncio.Event()
        self._sessions[session_id] = session
        self._stop_events[session_id] = stop_event

        task = asyncio.create_task(
            _run_session(session, stop_event),
            name=f"recorder-{session_id[:8]}",
        )
        session._task = task
        log.info("[recorder] started session %s camera=%d", session_id, camera_id)
        return session_id

    async def stop(self, session_id: str) -> Optional[RecordingSession]:
        """Signal a recording session to stop and wait for it to finish."""
        event = self._stop_events.get(session_id)
        session = self._sessions.get(session_id)
        if not event or not session:
            return None
        event.set()
        if session._task:
            try:
                await asyncio.wait_for(session._task, timeout=600)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                log.warning("[recorder] session %s did not finish cleanly", session_id)
        return session

    def get(self, session_id: str) -> Optional[RecordingSession]:
        return self._sessions.get(session_id)

    def list_sessions(self) -> List[RecordingSession]:
        return list(self._sessions.values())

    def merged_path(self, session_id: str) -> Optional[Path]:
        s = self._sessions.get(session_id)
        return s.merged_path if s else None


# Process-global manager instance
recording_manager = RecordingManager()
