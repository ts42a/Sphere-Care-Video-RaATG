from __future__ import annotations

from collections import Counter


def build_vocab(rows: list[dict[str, str]], min_freq: int = 1) -> dict[str, int]:
    special = ["<pad>", "<sos>", "<eos>", "<unk>"]
    counter: Counter[str] = Counter()
    for row in rows:
        counter.update(str(row.get("input", "")).strip().split())
        counter.update(str(row.get("output", "")).strip().split())

    stoi: dict[str, int] = {}
    for tok in special:
        stoi[tok] = len(stoi)
    for tok, freq in counter.items():
        if freq >= min_freq and tok not in stoi:
            stoi[tok] = len(stoi)
    return stoi
