from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from dataset_builder import create_detector, extract_hand_features
from dataset_manifest import RAW_CONVERTED_DIR, append_capture_metadata, append_sample_manifest
from label_spec import canonicalize_static_label


ROOT = Path(__file__).resolve().parent
OUT_DIR = RAW_CONVERTED_DIR / "static"


def _iter_label_dirs(source_root: Path) -> list[Path]:
    return sorted([p for p in source_root.iterdir() if p.is_dir()])


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert ASL alphabet image dataset to static 63D features.")
    parser.add_argument("--source-root", required=True, help="Path with per-label image folders.")
    parser.add_argument("--source-name", default="asl_alphabet", help="Dataset source tag for metadata.")
    parser.add_argument("--max-per-label", type=int, default=0, help="0 means no per-label cap.")
    parser.add_argument("--signer-id", default="online_public")
    args = parser.parse_args()

    source_root = Path(args.source_root).resolve()
    if not source_root.exists():
        raise FileNotFoundError(f"Source root not found: {source_root}")

    detector = create_detector(num_hands=1)
    session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    total_saved = 0
    total_skipped = 0

    try:
        for label_dir in _iter_label_dirs(source_root):
            try:
                mapped_label = canonicalize_static_label(label_dir.name)
            except ValueError:
                continue
            out_label_dir = OUT_DIR / mapped_label
            out_label_dir.mkdir(parents=True, exist_ok=True)

            saved_for_label = 0
            for img_path in sorted(label_dir.glob("*")):
                if args.max_per_label and saved_for_label >= args.max_per_label:
                    break
                if img_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}:
                    continue
                bgr = cv2.imread(str(img_path))
                if bgr is None:
                    total_skipped += 1
                    continue
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                rgb = np.ascontiguousarray(rgb)
                import mediapipe as mp

                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = detector.detect(mp_image)
                if not result.hand_landmarks:
                    total_skipped += 1
                    continue
                vec = extract_hand_features(result.hand_landmarks[0])
                out_name = f"{mapped_label}_{session_id}_{saved_for_label:06d}.npy"
                out_path = out_label_dir / out_name
                np.save(str(out_path), vec)
                rel = str(out_path.relative_to(ROOT)).replace("\\", "/")
                append_sample_manifest(
                    {
                        "sample_path": rel,
                        "task": "static",
                        "label": mapped_label,
                        "source": args.source_name,
                        "domain": "online",
                        "signer_id": args.signer_id,
                        "session_id": session_id,
                        "source_path": str(img_path),
                    },
                    dataset_kind="converted",
                )
                saved_for_label += 1
                total_saved += 1

        append_capture_metadata(
            {
                "session_id": session_id,
                "type": "static_conversion",
                "source": args.source_name,
                "source_root": str(source_root),
                "saved_count": total_saved,
                "skipped_count": total_skipped,
                "domain": "online",
                "signer_id": args.signer_id,
                "notes": "Converted from external image dataset using MediaPipe hand landmarks.",
            },
            dataset_kind="converted",
        )
    finally:
        if hasattr(detector, "close"):
            detector.close()

    print(f"Saved: {total_saved} static samples")
    print(f"Skipped: {total_skipped} samples")


if __name__ == "__main__":
    main()
