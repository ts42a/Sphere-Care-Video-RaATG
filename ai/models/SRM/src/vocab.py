from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path


SPECIAL_TOKENS = ["<pad>", "<sos>", "<eos>", "<unk>"]


def tokenize(text: str) -> list[str]:
    return text.strip().split()


def build_vocab(rows: list[dict[str, str]], min_freq: int = 1) -> dict[str, int]:
    counter: Counter[str] = Counter()
    for row in rows:
        counter.update(tokenize(row["input"]))
        counter.update(tokenize(row["output"]))

    vocab = {tok: idx for idx, tok in enumerate(SPECIAL_TOKENS)}
    for token, freq in counter.most_common():
        if freq >= min_freq and token not in vocab:
            vocab[token] = len(vocab)
    return vocab


def load_jsonl(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Build vocabulary for SRM.")
    parser.add_argument("--train_path", type=str, required=True)
    parser.add_argument("--output_path", type=str, required=True)
    parser.add_argument("--min_freq", type=int, default=1)
    args = parser.parse_args()

    rows = load_jsonl(Path(args.train_path))
    vocab = build_vocab(rows, min_freq=args.min_freq)
    payload = {
        "special_tokens": SPECIAL_TOKENS,
        "stoi": vocab,
        "itos": [tok for tok, _ in sorted(vocab.items(), key=lambda x: x[1])],
        "size": len(vocab),
    }
    out = Path(args.output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Saved vocab size={len(vocab)} -> {out}")


if __name__ == "__main__":
    main()
