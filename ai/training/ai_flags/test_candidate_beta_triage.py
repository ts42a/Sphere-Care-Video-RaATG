from __future__ import annotations

from ai.training.ai_flags.layers.beta import BetaCreation
from ai.training.ai_flags.layers.candidate import CandidateLayer
from ai.training.ai_flags.layers.triage import RiskTriage
from ai.training.ai_flags.layers.types import BetaFlag, FrameFact


def test_candidate_normalizes_evidence_for_all_event_types() -> None:
    layer = CandidateLayer()
    fact = FrameFact(
        ts=12.3,
        detections=[
            {"label": "person", "conf": 0.82, "bbox": [0.1, 0.1, 0.5, 0.8]},
            {"label": "knife", "conf": 0.71, "bbox": [0.4, 0.3, 0.55, 0.52]},
        ],
        motion_score=1.4,
        zone_hits=["hallway"],
        quality_flags={"low_visibility": False, "too_dark": False},
        specialist={
            "enabled": True,
            "backend": "mediapipe",
            "hand_conf": 0.67,
            "interaction_conf": 0.58,
            "proximity_score": 0.61,
            "hand_object_distance": 0.39,
        },
    )

    out = layer.process(fact)
    sharp = [c for c in out if c.event_type == "sharp_object"][0]
    ev = sharp.evidence

    assert "normalized" in ev
    assert "quality" in ev["normalized"]
    assert "specialist" in ev["normalized"]
    assert "detections" in ev["normalized"]
    assert ev["normalized"]["specialist"]["backend"] == "mediapipe"
    # Flat keys remain for backward compatibility.
    assert "low_visibility" in ev
    assert "interaction_conf" in ev


def test_beta_ids_are_stable_and_traceable() -> None:
    layer = CandidateLayer()
    fact = FrameFact(
        ts=5.0,
        detections=[{"label": "person", "conf": 0.9, "bbox": [0.1, 0.1, 0.2, 0.3]}],
        motion_score=0.1,
        zone_hits=["room_a"],
        quality_flags={"low_visibility": False},
        specialist={},
    )
    candidates = layer.process(fact)
    beta_layer = BetaCreation()
    betas = beta_layer.create([candidates[0], candidates[0]])

    assert betas[0].beta_id != betas[1].beta_id
    assert betas[0].beta_id.endswith("_1")
    assert betas[1].beta_id.endswith("_2")
    assert betas[0].evidence["trace"]["beta_id"] == betas[0].beta_id
    assert betas[1].evidence["trace"]["beta_source"] == "beta_creation_v2"


def _make_beta(ts: float, low_visibility: bool) -> BetaFlag:
    return BetaFlag(
        beta_id=f"beta_test_{ts}",
        event_type="sharp_object",
        ts=ts,
        confidence=0.4,
        zone="room_b",
        evidence={
            "low_visibility": False,  # top-level legacy value intentionally conflicts.
            "normalized": {
                "quality": {"low_visibility": low_visibility, "flags": {"low_visibility": low_visibility}},
                "specialist": {
                    "agreement": 1.0,
                    "interaction_conf": 0.6,
                    "hand_conf": 0.55,
                    "proximity_score": 0.7,
                },
            },
        },
    )


def test_triage_consumes_normalized_quality_and_specialist_fields() -> None:
    triage = RiskTriage(alpha_threshold=0.65, min_repeat_count=2, min_duration_sec=5.0)
    clear = triage.process([_make_beta(0.0, low_visibility=False), _make_beta(6.0, low_visibility=False)])
    degraded = triage.process([_make_beta(0.0, low_visibility=True), _make_beta(6.0, low_visibility=True)])

    assert clear[-1].level == "alpha"
    assert degraded[-1].level == "beta"
    assert degraded[-1].evidence["triage"]["quality_ok"] is False
    assert degraded[-1].evidence["triage"]["beta_id"].startswith("beta_test_")
