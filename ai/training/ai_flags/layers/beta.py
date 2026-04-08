from __future__ import annotations

import hashlib
from typing import Dict, List, Sequence

from .types import BetaFlag, CandidateEvent


class BetaCreation:
    """
    Layer 8: Opens first-level suspicious flags (Beta), including all object-based candidates.
    """

    def __init__(self) -> None:
        self._seq_by_base: Dict[str, int] = {}

    @staticmethod
    def _evidence_signature(c: CandidateEvent) -> str:
        norm = c.evidence.get("normalized", {}) if isinstance(c.evidence, dict) else {}
        parts = [
            c.event_type,
            c.zone,
            f"{float(c.ts):.3f}",
            f"{float(c.raw_confidence):.3f}",
            f"{float(norm.get('detections', {}).get('person_conf', c.evidence.get('person_conf', 0.0))):.3f}",
            f"{float(norm.get('detections', {}).get('knife_conf', c.evidence.get('knife_conf', 0.0))):.3f}",
            f"{float(norm.get('specialist', {}).get('interaction_conf', c.evidence.get('interaction_conf', 0.0))):.3f}",
        ]
        return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:10]

    def _build_beta_id(self, c: CandidateEvent) -> str:
        ts_ms = int(round(float(c.ts) * 1000.0))
        base = f"{c.event_type}:{c.zone}:{ts_ms}:{self._evidence_signature(c)}"
        seq = self._seq_by_base.get(base, 0) + 1
        self._seq_by_base[base] = seq
        return f"beta_{c.event_type}_{c.zone}_{ts_ms}_{seq}"

    def create(self, candidates: Sequence[CandidateEvent]) -> List[BetaFlag]:
        out: List[BetaFlag] = []
        for i, c in enumerate(candidates):
            beta_id = self._build_beta_id(c)
            evidence = dict(c.evidence)
            evidence["trace"] = {
                "candidate_index": i,
                "candidate_ts": float(c.ts),
                "candidate_zone": c.zone,
                "candidate_confidence": float(c.raw_confidence),
                "beta_id": beta_id,
                "beta_source": "beta_creation_v2",
            }
            out.append(
                BetaFlag(
                    beta_id=beta_id,
                    event_type=c.event_type,
                    ts=c.ts,
                    confidence=c.raw_confidence,
                    zone=c.zone,
                    evidence=evidence,
                )
            )
        return out
