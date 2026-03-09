# export.py - Copy trained models to runtime worker
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent
TRAIN_ARTIFACTS = ROOT / "artifacts" / "gesture"
RUNTIME_DIR = ROOT.parent.parent / "worker_ai" / "app" / "artifacts" / "gesture"
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

FILES = [
    "static_model.joblib",
    "static_labels.json",
    "motion_model.joblib",
    "motion_labels.json",
]


def main():
    for f in FILES:
        src = TRAIN_ARTIFACTS / f
        if src.exists():
            dst = RUNTIME_DIR / f
            shutil.copy(src, dst)
            print("Exported:", f)
    print("\nExport complete.")


if __name__ == "__main__":
    main()