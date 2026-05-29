from __future__ import annotations

import argparse
import json
import random
from pathlib import Path


DEFAULT_INPUT_FILES = [
    "srm_500_motion_tokens_only_clean.jsonl",
    "srm_500_motion_three_word_tokens_clean.jsonl",
    "srm_500_demo_day_motion_matrix_tokens_final.jsonl",
]


def load_jsonl(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def normalize_row(row: dict[str, str]) -> dict[str, str]:
    return {
        "input": str(row.get("input", "")).strip().lower(),
        "output": str(row.get("output", "")).strip(),
    }


def dedupe_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[tuple[str, str]] = set()
    out: list[dict[str, str]] = []
    for row in rows:
        normalized = normalize_row(row)
        key = (normalized["input"], normalized["output"])
        if key in seen:
            continue
        seen.add(key)
        out.append(normalized)
    return out


def split_rows(
    rows: list[dict[str, str]],
    train_ratio: float,
    val_ratio: float,
    seed: int,
) -> tuple[list[dict[str, str]], list[dict[str, str]], list[dict[str, str]]]:
    items = rows[:]
    random.Random(seed).shuffle(items)
    n = len(items)
    n_train = int(n * train_ratio)
    n_val = int(n * val_ratio)
    train = items[:n_train]
    val = items[n_train : n_train + n_val]
    test = items[n_train + n_val :]
    return train, val, test


def write_jsonl(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Split each motion JSONL file individually, merge split buckets "
            "(train+train, val+val, test+test), dedupe each merged bucket, and save."
        )
    )
    parser.add_argument(
        "--data_dir",
        type=str,
        default="ai/models/SRM/data/Motion",
        help="Directory containing the 3 source JSONL files and output train/val/test files.",
    )
    parser.add_argument(
        "--files",
        nargs="+",
        default=DEFAULT_INPUT_FILES,
        help="Input JSONL file names (relative to --data_dir).",
    )
    parser.add_argument("--train_ratio", type=float, default=0.70)
    parser.add_argument("--val_ratio", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    train_ratio = args.train_ratio
    val_ratio = args.val_ratio
    test_ratio = 1.0 - train_ratio - val_ratio
    if train_ratio <= 0 or val_ratio < 0 or test_ratio <= 0:
        raise ValueError("Invalid split ratios. Require train>0, val>=0, and test>0.")

    data_dir = Path(args.data_dir)
    input_paths = [data_dir / name for name in args.files]
    for p in input_paths:
        if not p.exists():
            raise FileNotFoundError(f"Input file not found: {p}")

    train_all: list[dict[str, str]] = []
    val_all: list[dict[str, str]] = []
    test_all: list[dict[str, str]] = []
    per_file_counts: list[dict[str, int | str]] = []

    for idx, path in enumerate(input_paths):
        source_rows = dedupe_rows(load_jsonl(path))
        tr, va, te = split_rows(
            source_rows,
            train_ratio=train_ratio,
            val_ratio=val_ratio,
            seed=args.seed + idx,
        )
        train_all.extend(tr)
        val_all.extend(va)
        test_all.extend(te)
        per_file_counts.append(
            {
                "file": path.name,
                "source_unique": len(source_rows),
                "train": len(tr),
                "val": len(va),
                "test": len(te),
            }
        )

    train_final = dedupe_rows(train_all)
    val_final = dedupe_rows(val_all)
    test_final = dedupe_rows(test_all)

    write_jsonl(data_dir / "train.jsonl", train_final)
    write_jsonl(data_dir / "val.jsonl", val_final)
    write_jsonl(data_dir / "test.jsonl", test_final)

    summary = {
        "ratios": {
            "train_ratio": train_ratio,
            "val_ratio": val_ratio,
            "test_ratio": test_ratio,
        },
        "per_file_split": per_file_counts,
        "merged_deduped_counts": {
            "train": len(train_final),
            "val": len(val_final),
            "test": len(test_final),
            "total": len(train_final) + len(val_final) + len(test_final),
        },
        "outputs": {
            "train": str(data_dir / "train.jsonl"),
            "val": str(data_dir / "val.jsonl"),
            "test": str(data_dir / "test.jsonl"),
        },
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()

