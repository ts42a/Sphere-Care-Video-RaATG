from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from dataset_builder import MOTION_NUM_HANDS, create_detector, extract_motion_features
from dataset_manifest import RAW_CONVERTED_DIR, append_capture_metadata, append_sample_manifest
from label_spec import canonicalize_motion_label


ROOT = Path(__file__).resolve().parent
OUT_DIR = RAW_CONVERTED_DIR / "motion"


def _build_video_index(videos_root: Path) -> dict[str, Path]:
    out: dict[str, Path] = {}
    for p in videos_root.rglob("*"):
        if p.is_file() and p.suffix.lower() in {".mp4", ".mov", ".avi", ".mkv", ".webm"}:
            out[p.stem] = p
    return out


def _iter_entries(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [v for v in payload if isinstance(v, dict)]
    if isinstance(payload, dict):
        values = payload.get("data")
        if isinstance(values, list):
            return [v for v in values if isinstance(v, dict)]
    return []


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert WLASL videos into motion gesture .npz samples.")
    parser.add_argument("--metadata-json", required=True, help="Path to WLASL metadata JSON file.")
    parser.add_argument("--videos-root", required=True, help="Root folder that contains downloaded videos.")
    parser.add_argument("--source-name", default="wlasl")
    parser.add_argument("--seq-len", type=int, default=10)
    parser.add_argument("--frame-step", type=int, default=2, help="Take every Nth frame.")
    parser.add_argument("--max-sequences-per-label", type=int, default=0, help="0 means unlimited.")
    args = parser.parse_args()

    meta_path = Path(args.metadata_json).resolve()
    videos_root = Path(args.videos_root).resolve()
    if not meta_path.exists():
        raise FileNotFoundError(f"Metadata file not found: {meta_path}")
    if not videos_root.exists():
        raise FileNotFoundError(f"Videos root not found: {videos_root}")
    if args.seq_len < 4:
        raise ValueError("--seq-len must be >= 4")
    if args.frame_step < 1:
        raise ValueError("--frame-step must be >= 1")

    with open(meta_path, "r", encoding="utf-8") as f:
        payload = json.load(f)
    entries = _iter_entries(payload)
    video_idx = _build_video_index(videos_root)

    detector = create_detector(num_hands=MOTION_NUM_HANDS)
    session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    saved_per_label: dict[str, int] = {}
    skipped_videos = 0
    total_saved = 0

    try:
        for row in entries:
            raw_label = str(row.get("gloss", "")).strip()
            try:
                mapped_label = canonicalize_motion_label(raw_label)
            except ValueError:
                continue
            instances = row.get("instances", [])
            if not isinstance(instances, list):
                continue
            out_label_dir = OUT_DIR / mapped_label
            out_label_dir.mkdir(parents=True, exist_ok=True)

            for ins in instances:
                if not isinstance(ins, dict):
                    continue
                current_count = saved_per_label.get(mapped_label, 0)
                if args.max_sequences_per_label and current_count >= args.max_sequences_per_label:
                    break
                video_id = str(ins.get("video_id", "")).strip()
                if not video_id:
                    continue
                video_path = video_idx.get(video_id)
                if video_path is None:
                    skipped_videos += 1
                    continue

                signer_id = str(ins.get("signer_id", "online_public")).strip() or "online_public"
                split_tag = str(ins.get("split", "")).strip().lower()
                cap = cv2.VideoCapture(str(video_path))
                if not cap.isOpened():
                    skipped_videos += 1
                    continue

                seq_frames: list[np.ndarray] = []
                frame_idx = 0
                try:
                    while True:
                        ok, bgr = cap.read()
                        if not ok:
                            break
                        if frame_idx % args.frame_step != 0:
                            frame_idx += 1
                            continue
                        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                        rgb = np.ascontiguousarray(rgb)
                        import mediapipe as mp

                        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                        res = detector.detect(mp_image)
                        if res.hand_landmarks:
                            seq_frames.append(extract_motion_features(res.hand_landmarks))
                        frame_idx += 1
                finally:
                    cap.release()

                while len(seq_frames) >= args.seq_len:
                    seq = np.stack(seq_frames[: args.seq_len], axis=0).astype(np.float32)
                    del seq_frames[: args.seq_len]
                    sample_idx = saved_per_label.get(mapped_label, 0)
                    out_name = f"{mapped_label}_{session_id}_{sample_idx:06d}.npz"
                    out_path = out_label_dir / out_name
                    np.savez(str(out_path), seq=seq)
                    rel = str(out_path.relative_to(ROOT)).replace("\\", "/")
                    append_sample_manifest(
                        {
                            "sample_path": rel,
                            "task": "motion",
                            "label": mapped_label,
                            "source": args.source_name,
                            "domain": "online",
                            "signer_id": signer_id,
                            "session_id": session_id,
                            "split": split_tag,
                            "source_video_id": video_id,
                            "source_path": str(video_path),
                        },
                        dataset_kind="converted",
                    )
                    saved_per_label[mapped_label] = sample_idx + 1
                    total_saved += 1

                    if (
                        args.max_sequences_per_label
                        and saved_per_label[mapped_label] >= args.max_sequences_per_label
                    ):
                        break

        append_capture_metadata(
            {
                "session_id": session_id,
                "type": "motion_conversion",
                "source": args.source_name,
                "source_root": str(videos_root),
                "metadata_json": str(meta_path),
                "saved_count": total_saved,
                "skipped_videos": skipped_videos,
                "domain": "online",
                "notes": "Converted from WLASL videos using MediaPipe hand landmarks.",
            },
            dataset_kind="converted",
        )
    finally:
        if hasattr(detector, "close"):
            detector.close()

    print(f"Saved motion sequences: {total_saved}")
    print(f"Skipped videos: {skipped_videos}")
    print(f"Labels converted: {len(saved_per_label)}")


if __name__ == "__main__":
    main()
