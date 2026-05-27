"""Quick check: dependencies, dataset manifests, trained artifacts, and report PNGs."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ARTIFACTS = ROOT / "artifacts" / "gesture"
TRAIN_REPORT = ARTIFACTS / "train_report"

REQUIRED_PACKAGES = (
    ("numpy", "numpy"),
    ("cv2", "opencv-python"),
    ("mediapipe", "mediapipe"),
    ("joblib", "joblib"),
    ("sklearn", "scikit-learn"),
    ("torch", "torch"),
    ("matplotlib", "matplotlib"),
)

REQUIRED_MODELS = (
    "static_model.joblib",
    "static_labels.json",
    "motion_model.pt",
    "motion_labels.json",
)

REQUIRED_REPORTS = (
    "static_train_report.json",
    "motion_train_report.json",
)

REQUIRED_PNGS = (
    ("static", "01_confusion_matrix.png"),
    ("static", "02_mean_features_by_class.png"),
    ("motion", "01_confusion_matrix.png"),
    ("motion", "02_mean_motion_by_class.png"),
)

REQUIRED_MANIFESTS = (
    ROOT / "dataset" / "sample_manifest_static_train.jsonl",
    ROOT / "dataset" / "sample_manifest_motion_train.jsonl",
)


def main() -> int:
    ok = True
    print("=== ai_transcript verify_setup ===\n")

    print("Python packages:")
    for mod, pip_name in REQUIRED_PACKAGES:
        try:
            m = __import__(mod if mod != "cv2" else "cv2")
            ver = getattr(m, "__version__", "?")
            print(f"  OK  {pip_name} ({ver})")
        except ImportError:
            print(f"  FAIL  {pip_name} — pip install {pip_name}")
            ok = False

    print("\nDataset manifests:")
    for path in REQUIRED_MANIFESTS:
        if path.exists() and path.stat().st_size > 0:
            lines = sum(1 for _ in path.open(encoding="utf-8") if _.strip())
            print(f"  OK  {path.name} ({lines} rows)")
        else:
            print(f"  FAIL  {path.name} missing or empty — run build_train_manifests.py")
            ok = False

    print("\nTrained models:")
    for name in REQUIRED_MODELS:
        p = ARTIFACTS / name
        if p.exists():
            print(f"  OK  {name} ({p.stat().st_size:,} bytes)")
        else:
            print(f"  FAIL  {name} — run run_pipeline.py --mode both")
            ok = False

    print("\nTrain reports (JSON):")
    for name in REQUIRED_REPORTS:
        p = TRAIN_REPORT / name
        if not p.exists():
            print(f"  FAIL  {name}")
            ok = False
            continue
        data = json.loads(p.read_text(encoding="utf-8"))
        gate = data.get("quality_gate", {})
        passed = gate.get("passed", False)
        obs = gate.get("observed", {})
        macro = obs.get("macro_f1", "?")
        status = "PASS" if passed else "FAIL"
        print(f"  {status}  {name} (macro_f1={macro})")
        if not passed:
            checks = gate.get("checks", {})
            failed = [k for k, v in checks.items() if v is False]
            if failed:
                print(f"         failed checks: {', '.join(failed)}")
                if "max_confusion_rate" in failed:
                    mx = obs.get("max_confusion_rate", "?")
                    allowed = gate.get("max_confusion_rate_allowed", 0.45)
                    print(f"         max_confusion_rate={mx} (allowed ≤ {allowed})")
            ok = False

    print("\nTraining images (PNG):")
    for subdir, fname in REQUIRED_PNGS:
        p = TRAIN_REPORT / subdir / fname
        if p.exists():
            print(f"  OK  {subdir}/{fname}")
        else:
            print(f"  FAIL  {subdir}/{fname} — run export_train_images.py --mode both")
            ok = False

    print()
    if ok:
        print("All checks passed. Ready for submission / live test (test.py, test_motion.py).")
        return 0
    print("Some checks failed. See README.md for the full pipeline.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
