"""Print top motion/static confusion pairs from saved train reports."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPORT_DIR = ROOT / "artifacts" / "gesture" / "train_report"


def _top_confusions(report_path: Path, *, top_n: int = 15) -> None:
    data = json.loads(report_path.read_text(encoding="utf-8"))
    task = data.get("task", report_path.stem)
    labels = data["result"]["metrics"]["confusion_matrix"]["labels"]
    mat = data["result"]["metrics"]["confusion_matrix"]["matrix"]
    pairs: list[tuple[int, float, str, str]] = []
    for i, true_l in enumerate(labels):
        row_sum = sum(mat[i])
        if row_sum <= 0:
            continue
        for j, pred_l in enumerate(labels):
            if i != j and mat[i][j] > 0:
                pairs.append((mat[i][j], mat[i][j] / row_sum, true_l, pred_l))
    pairs.sort(reverse=True)
    print(f"\n=== {task.upper()} — top confusions ===")
    for count, rate, true_l, pred_l in pairs[:top_n]:
        print(f"  {count:2d} ({rate * 100:5.1f}%)  {true_l} -> {pred_l}")
    gate = data.get("quality_gate", {})
    print(f"Quality gate: {'PASS' if gate.get('passed') else 'FAIL'}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", choices=["static", "motion", "both"], default="both")
    parser.add_argument("--top", type=int, default=15)
    args = parser.parse_args()
    tasks = ["static", "motion"] if args.task == "both" else [args.task]
    for task in tasks:
        path = REPORT_DIR / f"{task}_train_report.json"
        if not path.exists():
            print(f"Missing {path}")
            continue
        _top_confusions(path, top_n=args.top)


if __name__ == "__main__":
    main()
