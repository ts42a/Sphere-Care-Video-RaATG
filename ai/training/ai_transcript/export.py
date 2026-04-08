# export.py - Copy trained models to runtime worker
import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
TRAIN_ARTIFACTS = ROOT / "artifacts" / "gesture"
DEFAULT_RUNTIME_DIR = ROOT.parent.parent / "worker_ai" / "app" / "artifacts" / "gesture"

FILES = [
    "static_model.joblib",
    "static_labels.json",
    "motion_model.pt",
    "motion_labels.json",
]


def _file_sha1(path: Path) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {}


def main() -> None:
    parser = argparse.ArgumentParser(description="Export gesture artifacts to runtime directory.")
    parser.add_argument(
        "--runtime-dir",
        type=str,
        default=str(DEFAULT_RUNTIME_DIR),
        help="Destination directory for runtime gesture artifacts.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail if any expected artifact is missing before export.",
    )
    parser.add_argument(
        "--allow-failed-gate",
        action="store_true",
        help="Allow export even when training quality gate failed.",
    )
    args = parser.parse_args()

    runtime_dir = Path(args.runtime_dir).resolve()
    runtime_dir.mkdir(parents=True, exist_ok=True)
    copied = []
    missing = []

    build_manifest = _load_json(TRAIN_ARTIFACTS / "build_manifest.json")
    if not args.allow_failed_gate:
        failed_tasks = []
        for task in ("static", "motion"):
            task_block = build_manifest.get(task) or {}
            passed = task_block.get("quality_gate_passed")
            if passed is False:
                failed_tasks.append(task)
        if failed_tasks:
            raise RuntimeError(
                "Refusing export because quality gate failed for tasks: "
                + ", ".join(failed_tasks)
                + ". Use --allow-failed-gate to override."
            )

    for f in FILES:
        src = TRAIN_ARTIFACTS / f
        if src.exists():
            dst = runtime_dir / f
            shutil.copy(src, dst)
            copied.append(
                {
                    "file": f,
                    "src": str(src),
                    "dst": str(dst),
                    "bytes": int(dst.stat().st_size),
                    "sha1": _file_sha1(dst),
                }
            )
            print("Exported:", f)
        else:
            missing.append(f)

    if args.strict and missing:
        raise RuntimeError(f"Missing required artifacts before export: {missing}")

    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_dir": str(TRAIN_ARTIFACTS),
        "runtime_dir": str(runtime_dir),
        "quality_gate_checked": not args.allow_failed_gate,
        "copied_count": len(copied),
        "missing": missing,
        "copied": copied,
    }
    out_manifest = runtime_dir / "export_manifest.json"
    with open(out_manifest, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print("\nExport complete.")
    print("Manifest:", out_manifest)


if __name__ == "__main__":
    main()