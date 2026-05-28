"""
Step 5: Temporal sequence model over merged_frames.json.

Architecture: FeatureGate (GRN-style per-feature gating) -> BiGRU or BiLSTM
(default GRU) -> event probabilities + anomaly score.

Without trained --weights, the untrained RNN is ignored and outputs use the
rule-based head only (see --allow-untrained-model). With --weights, blend
--blend-rules controls how much rule logits are mixed in.

Reads the per-sample feature vectors as a single sequence and emits, per timestep:

    - per-feature gate weights (which inputs mattered)
    - event probabilities for a small fixed set of safety channels
    - an unsupervised anomaly score (masked input self-reconstruction error)
    - the RNN hidden state (optional; large, off by default)

Inputs
------
    merged/merged_frames.json     (Step 4, merge_frames.py)

Outputs
-------
    merged/temporal.json          fed into risk_engine.py (Step 6)

Run (from repo root):
    python ai/models/SCVAM2.1/temporal_grn.py
    python ai/models/SCVAM2.1/temporal_grn.py --hidden 192 --num-layers 3 --rnn-type lstm --save-hidden

The model's *architecture* is fixed and deterministic; without trained
weights the event/anomaly outputs are not calibrated. Two calibration
strategies that don't need any human labeling:

  1) Self-supervised pre-train on N runs by minimising masked-input
     reconstruction MSE; then re-run with --weights <path>.

  2) Bootstrap supervision from rule outputs already inside merged_frames.json
     (merged_signals.fall_like / obj_in_hand / unstable_gait). Treat them as
     soft labels with BCE.

For inference-only smoke-tests, the rule-derived heuristic head below
(`_rule_event_logits`) keeps the outputs sane even with random init.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

EVENT_NAMES: list[str] = [
    "person_active",
    "hand_visible",
    "obj_in_hand",
    "sharp_object_in_hand",
    "fall_like",
    "unstable_gait",
    "abnormal_posture",
    # Aged-care channels (rule bindings use merge_frames cross-frame proxies).
    "prolonged_immobility",
    "wandering_like",
    "environment_hazard_context",
]

# Mapping from event name -> (column-name patterns we expect to find inside
# merged_frames.json's feature vector). Used to bootstrap the heuristic head
# so untrained inference is still useful out-of-the-box.
_EVENT_RULE_BINDINGS: dict[str, list[tuple[str, float]]] = {
    "person_active": [
        ("step1_person_present_flag", 1.0),
        ("step1_person_max_conf", 1.0),
    ],
    "hand_visible": [
        ("step2_hands_found_max", 0.5),       # 0/1/2  -> /2 below
        ("step2_synth_hand_count", 0.4),
    ],
    "obj_in_hand": [
        ("step2_obj_in_hand_flag", 1.0),
        ("step2_obj_in_hand_max_conf", 2.0),  # boost low-conf evidence
    ],
    "sharp_object_in_hand": [
        ("step2_sharp_any_pick_flag", 1.0),
        ("step2_sharp_any_pick_max_conf", 2.5),
        ("step2_knife_any_pick_max_conf", 1.5),
    ],
    "fall_like": [
        ("step3_fall_score", 1.4),
        ("step3_posture_lying_score", 1.0),
        ("step3_head_below_hip_flag", 0.6),
    ],
    "unstable_gait": [
        ("step3_gait_instability_score", 1.6),
        ("step3_ankle_motion_asymmetry", 0.4),
        ("step3_torso_angle_drift_deg", 0.04),
    ],
    "abnormal_posture": [
        ("step3_posture_unknown_score", 0.7),
        ("step3_posture_lying_score", 0.6),
        ("step3_torso_angle_deg", 0.02),
    ],
    "prolonged_immobility": [
        ("ac_immobility_proxy", 2.0),
        ("step1_person_present_flag", 0.8),
        ("step3_posture_lying_score", 0.6),
        ("step3_posture_sitting_score", 0.6),
    ],
    "wandering_like": [
        ("ac_wandering_proxy", 2.0),
        ("step1_person_present_flag", 0.5),
        ("step3_hip_y_norm", 0.15),
    ],
    "environment_hazard_context": [
        ("ac_home_hazard_proxy", 1.8),
        ("step1_object_count_norm", 1.0),
        ("step3_gait_instability_score", 0.9),
    ],
}


# =============================================================================
#  filesystem helpers
# =============================================================================

def _package_dir() -> Path:
    return Path(__file__).resolve().parent


def _newest_run_dir() -> Path | None:
    out_root = _package_dir() / "output"
    if not out_root.is_dir():
        return None
    candidates = [
        d for d in out_root.iterdir()
        if d.is_dir() and (d / "merged" / "merged_frames.json").is_file()
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda d: d.stat().st_mtime, reverse=True)
    return candidates[0]


# =============================================================================
#  model
# =============================================================================

class FeatureGate(nn.Module):
    """Per-feature sigmoid gate conditioned on the masked input.
    Same idea as the variable-selection block from TFT/GRN: it lets the
    model decide which of the (lots of) hand-crafted features matter at
    each timestep without throwing any of them away."""

    def __init__(self, in_dim: int, hidden: int):
        super().__init__()
        self.proj = nn.Linear(in_dim * 2, hidden)
        self.gate = nn.Linear(hidden, in_dim)

    def forward(
        self, x: torch.Tensor, mask: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor]:
        z = torch.cat([x * mask, mask], dim=-1)
        h = F.elu(self.proj(z))
        g = torch.sigmoid(self.gate(h))
        return x * mask * g, g


class TemporalAnalyzer(nn.Module):
    def __init__(
        self,
        in_dim: int,
        hidden: int = 128,
        num_events: int = len(EVENT_NAMES),
        num_layers: int = 2,
        dropout: float = 0.1,
        rnn_type: str = "gru",
    ):
        super().__init__()
        rt = str(rnn_type).lower().strip()
        if rt not in {"gru", "lstm"}:
            raise ValueError("rnn_type must be 'gru' or 'lstm'")
        self.rnn_type = rt
        self.gate = FeatureGate(in_dim, hidden)
        rnn_kw: dict[str, Any] = dict(
            input_size=in_dim,
            hidden_size=hidden,
            num_layers=num_layers,
            batch_first=True,
            bidirectional=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.rnn = nn.GRU(**rnn_kw) if rt == "gru" else nn.LSTM(**rnn_kw)
        out_dim = hidden * 2
        self.event_head = nn.Linear(out_dim, num_events)
        self.recon_head = nn.Linear(out_dim, in_dim)

    def forward(
        self, x: torch.Tensor, mask: torch.Tensor
    ) -> dict[str, torch.Tensor]:
        gated, gates = self.gate(x, mask)
        h, _ = self.rnn(gated)
        event_logits = self.event_head(h)
        recon = self.recon_head(h)
        denom = mask.sum(-1).clamp(min=1.0)
        err = ((recon - gated) ** 2 * mask).sum(-1) / denom
        anomaly = torch.tanh(err * 4.0)
        return {
            "hidden": h,
            "gates": gates,
            "event_logits": event_logits,
            "event_probs": torch.sigmoid(event_logits),
            "recon": recon,
            "anomaly": anomaly,
        }


# =============================================================================
#  data loading
# =============================================================================

def _load_merged(path: Path) -> tuple[dict[str, Any], list[str], np.ndarray, np.ndarray, np.ndarray]:
    data = json.loads(path.read_text(encoding="utf-8"))
    names = data["feature_vector_names"]
    frames = data["frames"]
    F_dim = len(names)
    if not frames:
        X = np.zeros((0, F_dim), dtype=np.float32)
        M = np.zeros((0, F_dim), dtype=np.float32)
        ts = np.zeros((0,), dtype=np.float32)
        return data, names, X, M, ts
    X = np.zeros((len(frames), F_dim), dtype=np.float32)
    M = np.zeros((len(frames), F_dim), dtype=np.float32)
    ts = np.zeros((len(frames),), dtype=np.float32)
    for i, fr in enumerate(frames):
        v = fr.get("feature_vector") or []
        m = fr.get("feature_mask") or []
        for j in range(min(len(v), F_dim)):
            X[i, j] = float(v[j])
            M[i, j] = float(m[j]) if j < len(m) else 0.0
        ts[i] = float(fr.get("sample_ts_sec") or 0.0)
    return data, names, X, M, ts


def _column_index_lookup(names: list[str]) -> dict[str, int]:
    return {n: i for i, n in enumerate(names)}


def _rule_event_logits(
    X: np.ndarray, M: np.ndarray, names: list[str]
) -> np.ndarray:
    """Build a sane, untrained logit timeline directly from rule features.
    The GRU model is still run; this is what the runtime mixes the model
    output with when --use-rules is on (default)."""
    cols = _column_index_lookup(names)
    T = X.shape[0]
    out = np.full((T, len(EVENT_NAMES)), fill_value=-3.0, dtype=np.float32)
    for k, ev in enumerate(EVENT_NAMES):
        bindings = _EVENT_RULE_BINDINGS.get(ev, [])
        score = np.zeros((T,), dtype=np.float32)
        any_present = np.zeros((T,), dtype=np.float32)
        for col_name, weight in bindings:
            j = cols.get(col_name)
            if j is None:
                continue
            v = X[:, j].astype(np.float32)
            m = M[:, j].astype(np.float32)
            # squash high-magnitude raw features (e.g. drift in degrees)
            if col_name.endswith("_deg"):
                v = np.tanh(np.abs(v) / 30.0)
            else:
                v = np.clip(v, 0.0, 2.0)
            score = score + v * float(weight) * m
            any_present = np.maximum(any_present, m)
        # Centre logit so a "no-evidence" frame is around -3, full-evidence
        # around +3. Without this the sigmoid saturates at 0.5 for everything.
        if any_present.sum() > 0:
            out[:, k] = (score * 2.0 - 1.0) * any_present + (-3.0) * (1.0 - any_present)
        else:
            out[:, k] = -3.0
    return out


# =============================================================================
#  inference
# =============================================================================

def _resolve_rule_blend(
    *,
    weights_loaded: bool,
    blend_with_rules: float,
    allow_untrained_model: bool,
) -> float:
    """Fraction of rule logits in the final blend (1.0 = rules only)."""
    if not (0.0 <= blend_with_rules <= 1.0):
        raise ValueError("blend_with_rules must be in [0, 1]")
    if weights_loaded:
        return float(blend_with_rules)
    if allow_untrained_model:
        return float(blend_with_rules)
    return 1.0


def run_inference(
    merged_path: Path,
    *,
    hidden: int = 128,
    weights: Path | None = None,
    num_layers: int = 2,
    rnn_type: str = "gru",
    save_hidden: bool = False,
    save_gates: bool = False,
    blend_with_rules: float = 0.3,
    allow_untrained_model: bool = False,
    out_path: Path | None = None,
) -> Path:
    data, names, X, M, ts = _load_merged(merged_path)
    T, F_dim = X.shape

    if T == 0:
        out_path = out_path if out_path is not None else merged_path.with_name("temporal.json")
        payload: dict[str, Any] = {
            "merged_path": merged_path.as_posix(),
            "video": data.get("video"),
            "src_fps": data.get("src_fps"),
            "feature_vector_dim": F_dim,
            "feature_vector_names": names,
            "event_names": EVENT_NAMES,
            "T": 0,
            "model": {
                "type": f"Bi{str(rnn_type).upper()}+FeatureGate",
                "rnn_type": str(rnn_type).lower(),
                "hidden": hidden,
                "num_layers": num_layers,
                "weights_loaded": False,
                "weights_path": None,
            },
            "blend_rules_weight": 0.0,
            "note": "empty merged_frames sequence — no temporal inference run",
            "frames": [],
        }
        out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return out_path

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = TemporalAnalyzer(
        in_dim=F_dim,
        hidden=hidden,
        num_events=len(EVENT_NAMES),
        num_layers=num_layers,
        rnn_type=rnn_type,
    ).to(device).eval()

    weights_loaded = False
    if weights is not None and weights.is_file():
        try:
            model.load_state_dict(torch.load(weights, map_location=device))
            weights_loaded = True
        except Exception as exc:
            print(f"[WARN] could not load weights {weights}: {exc} -- continuing with random init.")

    with torch.no_grad():
        x = torch.from_numpy(X).unsqueeze(0).to(device)
        m = torch.from_numpy(M).unsqueeze(0).to(device)
        out = model(x, m)

    model_logits = out["event_logits"][0].cpu().numpy()           # (T, E)
    model_probs = out["event_probs"][0].cpu().numpy()             # (T, E)
    anomaly = out["anomaly"][0].cpu().numpy()                     # (T,)
    gates_np = out["gates"][0].cpu().numpy() if save_gates else None
    hidden_np = out["hidden"][0].cpu().numpy() if save_hidden else None

    rule_logits = _rule_event_logits(X, M, names)
    a = _resolve_rule_blend(
        weights_loaded=weights_loaded,
        blend_with_rules=blend_with_rules,
        allow_untrained_model=allow_untrained_model,
    )
    if not weights_loaded and not allow_untrained_model:
        print(
            "[INFO] No --weights loaded: temporal event_probs use the rule-based "
            "head only (untrained BiGRU is not blended in). Pass --allow-untrained-model "
            "to mix in the random-init RNN for experiments."
        )
    blended_logits = (1.0 - a) * model_logits + a * rule_logits
    final_probs = 1.0 / (1.0 + np.exp(-blended_logits))

    payload: dict[str, Any] = {
        "merged_path": merged_path.as_posix(),
        "video": data.get("video"),
        "src_fps": data.get("src_fps"),
        "feature_vector_dim": F_dim,
        "feature_vector_names": names,
        "event_names": EVENT_NAMES,
        "T": int(T),
        "model": {
            "type": f"Bi{str(rnn_type).upper()}+FeatureGate",
            "rnn_type": str(rnn_type).lower(),
            "hidden": hidden,
            "num_layers": num_layers,
            "weights_loaded": weights_loaded,
            "weights_path": (weights.as_posix() if weights is not None else None),
        },
        "blend_rules_weight": float(a),
        "rules_only_untrained": bool(not weights_loaded and a >= 1.0 - 1e-6),
        "frames": [
            {
                "sample_frame": data["frames"][i]["sample_frame"],
                "sample_ts_sec": float(ts[i]),
                "event_probs": {
                    EVENT_NAMES[k]: float(final_probs[i, k]) for k in range(len(EVENT_NAMES))
                },
                "event_probs_model": {
                    EVENT_NAMES[k]: float(model_probs[i, k]) for k in range(len(EVENT_NAMES))
                },
                "event_probs_rules": {
                    EVENT_NAMES[k]: float(1.0 / (1.0 + math.exp(-rule_logits[i, k])))
                    for k in range(len(EVENT_NAMES))
                },
                "anomaly_score": float(anomaly[i]),
            }
            for i in range(T)
        ],
    }
    if save_gates and gates_np is not None:
        # Top-N most-active features per timestep, by mean activation across
        # the run, to keep the file size sane.
        mean_activation = gates_np.mean(axis=0)
        top_idx = np.argsort(-mean_activation)[: min(20, F_dim)]
        payload["top_features_by_mean_gate"] = [
            {"name": names[j], "mean_gate": float(mean_activation[j])}
            for j in top_idx
        ]
    if save_hidden and hidden_np is not None:
        payload["hidden_states"] = hidden_np.tolist()

    out_path = out_path if out_path is not None else merged_path.with_name("temporal.json")
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return out_path


# =============================================================================
#  CLI
# =============================================================================

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Step 5: BiGRU/BiLSTM + feature-gate temporal analyzer over merged_frames.json."
    )
    parser.add_argument(
        "--merged",
        default="",
        help="Path to merged/merged_frames.json. Default: newest run dir.",
    )
    parser.add_argument(
        "--weights",
        default="",
        help="Trained .pt for TemporalAnalyzer. If empty/missing, random init "
        "is used and the rule-based head dominates.",
    )
    parser.add_argument("--hidden", type=int, default=128)
    parser.add_argument("--num-layers", type=int, default=2)
    parser.add_argument(
        "--rnn-type",
        choices=("gru", "lstm"),
        default="gru",
        help="Recurrent core after FeatureGate: GRU (default) or LSTM.",
    )
    parser.add_argument(
        "--blend-rules",
        type=float,
        default=0.3,
        help="Rule-logit weight when --weights are loaded (0=GRU only, 1=rules only). "
        "Default 0.3 -> mostly trained GRU. Ignored when no weights unless "
        "--allow-untrained-model is set.",
    )
    parser.add_argument(
        "--allow-untrained-model",
        action="store_true",
        help="When no --weights are loaded, still blend in the random-init GRU "
        "using --blend-rules. Default: rules-only (no untrained RNN noise).",
    )
    parser.add_argument("--save-hidden", action="store_true",
                        help="Include the RNN hidden states in the JSON (large).")
    parser.add_argument("--save-gates", action="store_true",
                        help="Include the top-20 most-active feature gates.")
    parser.add_argument(
        "--out",
        default="",
        help="Output path (default: <run>/merged/temporal.json).",
    )
    args = parser.parse_args()

    if args.merged:
        merged_path = Path(args.merged).expanduser().resolve()
    else:
        latest = _newest_run_dir()
        if latest is None:
            print(
                "No --merged given and no run dir under "
                "ai/models/SCVAM2.1/output/*/merged/merged_frames.json.\n"
                "Run merge_frames.py first."
            )
            return 1
        merged_path = latest / "merged" / "merged_frames.json"

    if not merged_path.is_file():
        print(f"[ERROR] merged_frames.json not found at {merged_path}")
        return 1

    weights = Path(args.weights).expanduser().resolve() if args.weights else None
    out_path = Path(args.out).expanduser().resolve() if args.out else None

    out = run_inference(
        merged_path,
        hidden=args.hidden,
        weights=weights,
        num_layers=args.num_layers,
        rnn_type=args.rnn_type,
        save_hidden=args.save_hidden,
        save_gates=args.save_gates,
        blend_with_rules=args.blend_rules,
        allow_untrained_model=args.allow_untrained_model,
        out_path=out_path,
    )
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
