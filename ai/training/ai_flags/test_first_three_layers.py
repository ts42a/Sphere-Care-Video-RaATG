from __future__ import annotations

from typing import List

import cv2
import numpy as np

from ai.training.ai_flags.layers.ingest import IngestLayer
from ai.training.ai_flags.layers.quality import DataQualityGate
from ai.training.ai_flags.layers.selector import FrameSelector
from ai.training.ai_flags.layers.types import QualityFrame, RawFrame


class _FakeVideoCapture:
    def __init__(self, frames: List[np.ndarray], fps: float = 6.0) -> None:
        self._frames = frames
        self._fps = fps
        self._i = 0
        self._released = False

    def isOpened(self) -> bool:
        return True

    def read(self) -> tuple[bool, np.ndarray | None]:
        if self._i >= len(self._frames):
            return False, None
        frame = self._frames[self._i]
        self._i += 1
        return True, frame

    def get(self, prop: int) -> float:
        if prop == cv2.CAP_PROP_FPS:
            return float(self._fps)
        if prop == cv2.CAP_PROP_POS_MSEC:
            return (self._i * 1000.0) / float(self._fps)
        return 0.0

    def release(self) -> None:
        self._released = True


def _make_qf(ts: float, value: int) -> QualityFrame:
    bgr = np.full((36, 64, 3), value, dtype=np.uint8)
    raw = RawFrame(index=int(ts * 10), ts=ts, bgr=bgr, source_id="cam0")
    return QualityFrame(
        frame=raw,
        low_visibility=False,
        quality_flags={"low_visibility": False},
        quality_scores={},
    )


def test_ingest_layer_downsamples_and_sets_metadata(monkeypatch) -> None:
    frames = [np.full((120, 200, 3), i * 10, dtype=np.uint8) for i in range(6)]
    fake_cap = _FakeVideoCapture(frames=frames, fps=6.0)

    import ai.training.ai_flags.layers.ingest as ingest_module

    monkeypatch.setattr(ingest_module.cv2, "VideoCapture", lambda _source: fake_cap)

    layer = IngestLayer("fake_source.mp4", max_fps=2.0, max_width=100)
    out = list(layer.iter_frames())

    assert len(out) == 2
    assert out[0].index == 0
    assert out[1].index == 1
    assert out[0].ts < out[1].ts
    assert out[0].metadata["max_fps"] == 2.0
    assert out[0].metadata["native_fps"] == 6.0
    assert out[0].metadata["width"] <= 100
    assert out[0].metadata["height"] > 0


def test_quality_gate_sets_low_visibility_for_dark_frames() -> None:
    bgr = np.zeros((64, 64, 3), dtype=np.uint8)
    raw = RawFrame(index=0, ts=0.0, bgr=bgr, source_id="cam0")

    gate = DataQualityGate(dark_threshold=35.0, blur_threshold=70.0, occlusion_ratio_threshold=0.80)
    qf = gate.evaluate(raw)

    assert qf.quality_flags["too_dark"] is True
    assert qf.quality_flags["low_visibility"] is True
    assert qf.low_visibility is True


def test_frame_selector_applies_dedupe_min_floor_and_burst() -> None:
    selector = FrameSelector(
        min_interval_sec=1.0,
        dedupe_threshold=2.0,
        burst_motion_threshold=8.0,
        burst_frames=2,
    )

    q1 = _make_qf(0.0, 10)
    q2 = _make_qf(0.2, 10)   # near-duplicate, too soon
    q3 = _make_qf(1.2, 10)   # same frame but min floor elapsed
    q4 = _make_qf(1.3, 240)  # scene spike, starts burst
    q5 = _make_qf(1.4, 10)   # burst continuation despite short interval

    assert selector.should_select(q1) is True
    assert selector.should_select(q2) is False
    assert selector.should_select(q3) is True
    assert selector.should_select(q4) is True
    assert selector.should_select(q5) is True
