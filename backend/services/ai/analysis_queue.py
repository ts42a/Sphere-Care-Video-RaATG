"""
Internal-only analysis queue for GPU-serialized video processing.

Multiple recording sessions can submit clips concurrently, but only one
clip is analyzed at a time to respect kernel-level GPU constraints.

This object is process-private — never exposed via any HTTP endpoint.
The only way to interact with it is by calling submit() from within
the backend process (recorder.py is the sole caller).

Jobs are consumed and destroyed after processing; nothing is retained.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

log = logging.getLogger("sphere_care.analysis_queue")

# Configurable via env; guards against unbounded memory when cameras
# outnumber GPU throughput.
_DEFAULT_MAX_SIZE = 64


@dataclass
class _AnalysisJob:
    session_id: str
    camera_id: int
    clip_path: Path
    admin_id: int
    resident_id: Optional[int]
    resident_name: str
    _future: object = field(default=None, repr=False)  # asyncio.Future, set at submit time


class AnalysisQueue:
    """
    Single-worker queue that serializes GPU clip analysis across all sessions.

    Usage (from recorder):
        results = await analysis_queue.submit(session_id=..., clip_path=..., ...)

    The worker is started once by the app lifespan (main.py) and never
    restarted by callers.
    """

    def __init__(self, max_size: int = _DEFAULT_MAX_SIZE) -> None:
        self._max_size = max_size
        self._queue: asyncio.Queue[_AnalysisJob] = asyncio.Queue(maxsize=max_size)
        self._worker_task: Optional[asyncio.Task] = None

    def start(self) -> None:
        """Start the background drain worker. Call exactly once from app lifespan."""
        if self._worker_task and not self._worker_task.done():
            return
        self._worker_task = asyncio.create_task(
            self._drain(), name="analysis-queue-worker"
        )
        log.info("[analysis_queue] worker started (max_size=%d)", self._max_size)

    def stop(self) -> None:
        """Cancel the drain worker on shutdown."""
        if self._worker_task:
            self._worker_task.cancel()

    @property
    def depth(self) -> int:
        """Current number of pending jobs."""
        return self._queue.qsize()

    async def submit(
        self,
        *,
        session_id: str,
        camera_id: int,
        clip_path: Path,
        admin_id: int,
        resident_id: Optional[int],
        resident_name: str,
    ) -> List[Tuple[int, int]]:
        """
        Enqueue a clip for analysis and await the result.

        Raises QueueFullError if the queue is at capacity so the caller
        can decide whether to skip analysis or abort the session.

        Returns a list of (flag_id, insight_id) pairs from the AI pipeline.
        The job object is destroyed after the result is delivered.
        """
        if self._queue.full():
            raise QueueFullError(
                f"Analysis queue is full ({self._max_size} jobs pending). "
                "Clip will not be analysed."
            )

        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        job = _AnalysisJob(
            session_id=session_id,
            camera_id=camera_id,
            clip_path=clip_path,
            admin_id=admin_id,
            resident_id=resident_id,
            resident_name=resident_name,
            _future=fut,
        )
        await self._queue.put(job)
        log.debug(
            "[analysis_queue] enqueued clip=%s session=%s depth=%d/%d",
            clip_path.name, session_id[:8], self._queue.qsize(), self._max_size,
        )
        return await fut

    async def _drain(self) -> None:
        """Pull and process one job at a time — never two concurrently."""
        while True:
            job = await self._queue.get()
            log.info(
                "[analysis_queue] start clip=%s session=%s remaining=%d",
                job.clip_path.name, job.session_id[:8], self._queue.qsize(),
            )
            try:
                results = await asyncio.to_thread(_run_analysis, job)
                job._future.set_result(results)
            except Exception as exc:
                log.exception(
                    "[analysis_queue] failed clip=%s: %s", job.clip_path.name, exc
                )
                if not job._future.done():
                    job._future.set_exception(exc)
            finally:
                self._queue.task_done()
                log.info(
                    "[analysis_queue] done clip=%s session=%s",
                    job.clip_path.name, job.session_id[:8],
                )


class QueueFullError(RuntimeError):
    """Raised when a clip is submitted to a full analysis queue."""


def _run_analysis(job: _AnalysisJob) -> List[Tuple[int, int]]:
    """
    Blocking AI pipeline execution — always runs inside asyncio.to_thread
    so the event loop is never blocked.

    Opens and closes its own DB session; does not share state with callers.
    """
    from backend.db.session import SessionLocal
    from backend.services.ai.vision.pipeline import run_detection_pipeline
    from backend.services.ai.vision.video_ingest import iter_video_frames
    from backend.core import config as app_config

    db = SessionLocal()
    try:
        return run_detection_pipeline(
            db,
            admin_id=job.admin_id,
            resident_name=job.resident_name,
            resident_id=job.resident_id,
            camera_id=job.camera_id,
            frame_iter=iter_video_frames(
                str(job.clip_path), max_fps=app_config.AI_MAX_SAMPLE_FPS
            ),
            detector_kind="mock",
            use_llm=app_config.AI_USE_LLM,
            model_label="sphere-care-recorder",
        )
    except Exception:
        log.exception("[analysis_queue] pipeline error on %s", job.clip_path.name)
        return []
    finally:
        db.close()


# ── Process-global singleton ──────────────────────────────────────────────────
# Accessible only from within this process. The HTTP layer has no reference
# to this object and no endpoint that could expose it.
# ─────────────────────────────────────────────────────────────────────────────
def _make_queue() -> AnalysisQueue:
    from backend.core import config as app_config
    size = getattr(app_config, "ANALYSIS_QUEUE_MAX_SIZE", _DEFAULT_MAX_SIZE)
    return AnalysisQueue(max_size=int(size))


analysis_queue: AnalysisQueue = _make_queue()
