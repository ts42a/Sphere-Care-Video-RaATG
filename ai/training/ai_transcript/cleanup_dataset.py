"""
Keep only final training data: train manifests + referenced raw_custom files.
Run: python cleanup_dataset.py
"""
from __future__ import annotations

import json
import os
import shutil
import stat
from pathlib import Path


def _rmtree_force(path: Path) -> None:
    def _onerror(func, p, exc_info):  # noqa: ANN001
        if not os.path.exists(p):
            return
        os.chmod(p, stat.S_IWRITE)
        func(p)

    if path.exists():
        shutil.rmtree(path, onerror=_onerror)

ROOT = Path(__file__).resolve().parent
DATASET = ROOT / "dataset"
STATIC_MANIFEST = DATASET / "sample_manifest_static_train.jsonl"
MOTION_MANIFEST = DATASET / "sample_manifest_motion_train.jsonl"
RAW_STATIC = DATASET / "raw_custom" / "static"
RAW_MOTION = DATASET / "raw_custom" / "motion"

KEEP_TOP_LEVEL = {
    "raw_custom",
    "sample_manifest_static_train.jsonl",
    "sample_manifest_motion_train.jsonl",
    "labels_train.json",
}

def _load_paths(manifest: Path) -> set[str]:
    paths: set[str] = set()
    with open(manifest, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            rel = str(row.get("sample_path", "")).replace("\\", "/").strip()
            if rel:
                paths.add(rel)
    return paths


def main() -> None:
    if not STATIC_MANIFEST.exists() or not MOTION_MANIFEST.exists():
        raise SystemExit("Run build_train_manifests.py first.")

    keep = _load_paths(STATIC_MANIFEST) | _load_paths(MOTION_MANIFEST)
    print(f"Keeping {len(keep)} referenced samples")

    removed_files = 0
    for root, exts in ((RAW_STATIC, (".npy",)), (RAW_MOTION, (".npz",))):
        if not root.exists():
            continue
        for fp in root.rglob("*"):
            if not fp.is_file() or fp.suffix not in exts:
                continue
            rel = str(fp.relative_to(ROOT)).replace("\\", "/")
            if rel not in keep:
                fp.unlink()
                removed_files += 1

    # Remove anything at dataset/ root that is not in KEEP_TOP_LEVEL.
    for entry in list(DATASET.iterdir()):
        name = entry.name
        if name in KEEP_TOP_LEVEL:
            continue
        if entry.is_dir():
            _rmtree_force(entry)
            print("Removed dir:", entry.relative_to(ROOT))
        elif entry.is_file():
            entry.unlink()
            print("Removed file:", entry.relative_to(ROOT))

    # Remove stray manifests/metadata under raw_custom.
    for stray in RAW_STATIC.glob("*.jsonl"):
        stray.unlink()
        print("Removed file:", stray.relative_to(ROOT))
    for meta in (DATASET / "raw_custom").rglob("metadata*.jsonl"):
        meta.unlink()
        print("Removed file:", meta.relative_to(ROOT))
    for manifest in (DATASET / "raw_custom").rglob("sample_manifest*.jsonl"):
        manifest.unlink()
        print("Removed file:", manifest.relative_to(ROOT))

    print(f"Removed {removed_files} unreferenced raw_custom files")
    print("Done. Final manifests:")
    print(" ", STATIC_MANIFEST.relative_to(ROOT))
    print(" ", MOTION_MANIFEST.relative_to(ROOT))
    print(" ", (DATASET / "labels_train.json").relative_to(ROOT))


if __name__ == "__main__":
    main()
