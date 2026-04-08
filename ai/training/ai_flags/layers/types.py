from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List

import numpy as np


@dataclass
class RawFrame:
    index: int
    ts: float
    bgr: np.ndarray
    source_id: str
    metadata: Dict[str, object] = field(default_factory=dict)


@dataclass
class QualityFrame:
    frame: RawFrame
    low_visibility: bool
    quality_flags: Dict[str, bool]
    quality_scores: Dict[str, float]


@dataclass
class FrameFact:
    ts: float
    detections: List[Dict[str, object]]
    motion_score: float
    zone_hits: List[str]
    quality_flags: Dict[str, bool]
    specialist: Dict[str, object] = field(default_factory=dict)


@dataclass
class CandidateEvent:
    event_type: str
    ts: float
    evidence: Dict[str, object]
    raw_confidence: float
    zone: str


@dataclass
class BetaFlag:
    beta_id: str
    event_type: str
    ts: float
    confidence: float
    zone: str
    evidence: Dict[str, object]
    status: str = "beta"


@dataclass
class TriagedEvent:
    event_id: str
    event_type: str
    level: str
    confidence: float
    zone: str
    ts: float
    evidence: Dict[str, object]
