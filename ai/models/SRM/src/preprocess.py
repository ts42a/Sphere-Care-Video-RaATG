from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

MULTISPACE_RE = re.compile(r"\s+")


def normalize_input(text: str) -> str:
    text = text.strip().lower()
    text = MULTISPACE_RE.sub(" ", text)
    return text


def normalize_output(text: str) -> str:
    text = text.strip()
    text = MULTISPACE_RE.sub(" ", text)
    if not text:
        return text
    if text[0].islower():
        text = text[0].upper() + text[1:]
    if text[-1] not in ".?!":
        text += "."
    return text


def load_jsonl(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            rows.append({"input": str(row["input"]), "output": str(row["output"])})
    return rows


def save_jsonl(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def preprocess_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    cleaned: list[dict[str, str]] = []
    for row in rows:
        src = normalize_input(row["input"])
        tgt = normalize_output(row["output"])
        if src and tgt:
            cleaned.append({"input": src, "output": tgt})
    return cleaned


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize SRM JSONL files.")
    parser.add_argument("--input", type=str, required=True, help="Input JSONL path.")
    parser.add_argument("--output", type=str, required=True, help="Output JSONL path.")
    args = parser.parse_args()

    in_path = Path(args.input)
    out_path = Path(args.output)
    rows = load_jsonl(in_path)
    cleaned = preprocess_rows(rows)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    save_jsonl(out_path, cleaned)
    print(f"Cleaned {len(cleaned)} rows -> {out_path}")


if __name__ == "__main__":
    main()
