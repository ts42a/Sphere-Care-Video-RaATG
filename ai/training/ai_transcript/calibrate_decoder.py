from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
REPORTS_DIR = ROOT / "artifacts" / "gesture" / "reports"
OUT_PATH = ROOT / "artifacts" / "gesture" / "decoder_calibration.json"


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {}


def _suggest_threshold(macro_f1: float, *, floor: float = 0.55, ceil: float = 0.85) -> float:
    value = 0.7 + (macro_f1 - 0.7) * 0.2
    return float(max(floor, min(ceil, value)))


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate decoder calibration defaults from evaluation reports.")
    parser.add_argument("--static-report", type=str, default=str(REPORTS_DIR / "static_evaluation_report.json"))
    parser.add_argument("--motion-report", type=str, default=str(REPORTS_DIR / "motion_evaluation_report.json"))
    parser.add_argument("--out", type=str, default=str(OUT_PATH))
    args = parser.parse_args()

    static_rep = _load_json(Path(args.static_report).resolve())
    motion_rep = _load_json(Path(args.motion_report).resolve())
    static_f1 = float(
        (((static_rep.get("holdout") or {}).get("metrics") or {}).get("macro_f1") or 0.7)
    )
    motion_f1 = float(
        (((motion_rep.get("holdout") or {}).get("metrics") or {}).get("macro_f1") or 0.7)
    )

    payload = {
        "schema_version": "decoder_calibration_v1",
        "static": {
            "confidence_threshold": _suggest_threshold(static_f1),
            "history_size": 8,
            "stable_min_votes": 6,
            "append_cooldown_seconds": 1.0,
        },
        "motion": {
            "confidence_threshold": _suggest_threshold(motion_f1),
            "history_size": 6,
            "stable_min_votes": 4,
            "append_cooldown_seconds": 1.2,
        },
        "sources": {
            "static_report": str(Path(args.static_report).resolve()),
            "motion_report": str(Path(args.motion_report).resolve()),
        },
    }

    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print("Saved calibration:", out_path)


if __name__ == "__main__":
    main()
