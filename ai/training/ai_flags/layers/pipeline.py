from __future__ import annotations

from typing import Dict, List

from .beta import BetaCreation
from .candidate import CandidateLayer
from .ingest import IngestLayer
from .perception import PerceptionLayer
from .postprocess import AlphaPathProcessor, BranchDecision, ObservationPathProcessor
from .quality import DataQualityGate
from .selector import FrameSelector
from .triage import RiskTriage
from .types import CandidateEvent, FrameFact


def run_first_three_layers(
    source: str,
    *,
    max_frames: int = 120,
    detector_kind: str = "mock",
    camera_id: int = 0,
    selector_min_interval_sec: float = 1.0,
    selector_dedupe_threshold: float = 2.0,
    selector_burst_motion_threshold: float = 8.0,
    selector_burst_frames: int = 2,
    specialist_enabled: bool = False,
    specialist_backend: str = "heuristic",
) -> List[FrameFact]:
    ingest = IngestLayer(source)
    quality = DataQualityGate()
    selector = FrameSelector(
        min_interval_sec=selector_min_interval_sec,
        dedupe_threshold=selector_dedupe_threshold,
        burst_motion_threshold=selector_burst_motion_threshold,
        burst_frames=selector_burst_frames,
    )
    perception = PerceptionLayer(
        detector_kind=detector_kind,
        camera_id=camera_id,
        strict_detector=(detector_kind == "yolo"),
        specialist_enabled=specialist_enabled,
        specialist_backend=specialist_backend,
    )

    out: List[FrameFact] = []
    for frame in ingest.iter_frames():
        if len(out) >= max_frames:
            break
        qf = quality.evaluate(frame)
        if not selector.should_select(qf):
            continue
        out.append(perception.process(qf))
    return out


def run_first_seven_layers(
    source: str,
    *,
    max_frames: int = 120,
    detector_kind: str = "mock",
    camera_id: int = 0,
    selector_min_interval_sec: float = 1.0,
    selector_dedupe_threshold: float = 2.0,
    selector_burst_motion_threshold: float = 8.0,
    selector_burst_frames: int = 2,
    specialist_enabled: bool = False,
    specialist_backend: str = "heuristic",
) -> Dict[str, List[object]]:
    facts = run_first_three_layers(
        source,
        max_frames=max_frames,
        detector_kind=detector_kind,
        camera_id=camera_id,
        selector_min_interval_sec=selector_min_interval_sec,
        selector_dedupe_threshold=selector_dedupe_threshold,
        selector_burst_motion_threshold=selector_burst_motion_threshold,
        selector_burst_frames=selector_burst_frames,
        specialist_enabled=specialist_enabled,
        specialist_backend=specialist_backend,
    )
    candidate_layer = CandidateLayer()
    beta_layer = BetaCreation()
    triage = RiskTriage()

    candidates: List[CandidateEvent] = []
    for f in facts:
        candidates.extend(candidate_layer.process(f))
    betas = beta_layer.create(candidates)
    triaged = triage.process(betas)
    return {
        "frame_facts": facts,
        "candidates": candidates,
        "betas": betas,
        "triaged": triaged,
    }


def run_full_system(
    source: str,
    *,
    max_frames: int = 120,
    detector_kind: str = "mock",
    camera_id: int = 0,
    specialist_enabled: bool = False,
    specialist_backend: str = "heuristic",
) -> Dict[str, object]:
    """
    End-to-end flow:
    Video -> Ingest -> DataQualityGate -> Perception -> Candidate -> BetaCreation
    -> RiskTriage -> BranchDecision -> (AlphaPath | ObservationPath)
    """
    base = run_first_seven_layers(
        source,
        max_frames=max_frames,
        detector_kind=detector_kind,
        camera_id=camera_id,
        specialist_enabled=specialist_enabled,
        specialist_backend=specialist_backend,
    )
    triaged = base["triaged"]
    decision = BranchDecision.from_triaged(triaged)  # type: ignore[arg-type]

    if decision.branch == "alpha_path":
        branch_output = AlphaPathProcessor().process(triaged)  # type: ignore[arg-type]
    else:
        branch_output = ObservationPathProcessor().process(triaged)  # type: ignore[arg-type]

    out: Dict[str, object] = dict(base)
    out["branch_decision"] = {"alpha_count": decision.alpha_count, "branch": decision.branch}
    out["branch_output"] = branch_output
    return out
