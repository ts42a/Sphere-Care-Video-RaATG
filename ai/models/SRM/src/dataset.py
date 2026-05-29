from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import torch
from torch.nn.utils.rnn import pad_sequence
from torch.utils.data import Dataset


def tokenize(text: str) -> list[str]:
    return text.strip().split()


@dataclass
class Vocab:
    stoi: dict[str, int]
    itos: list[str]
    pad_idx: int
    sos_idx: int
    eos_idx: int
    unk_idx: int

    @classmethod
    def from_json(cls, path: Path) -> "Vocab":
        payload = json.loads(path.read_text(encoding="utf-8"))
        stoi = payload["stoi"]
        return cls(
            stoi=stoi,
            itos=payload["itos"],
            pad_idx=stoi["<pad>"],
            sos_idx=stoi["<sos>"],
            eos_idx=stoi["<eos>"],
            unk_idx=stoi["<unk>"],
        )

    def encode(self, text: str) -> list[int]:
        return [self.stoi.get(tok, self.unk_idx) for tok in tokenize(text)]


class SentenceRefinerDataset(Dataset):
    def __init__(self, rows: list[dict[str, str]], vocab: Vocab) -> None:
        self.rows = rows
        self.vocab = vocab

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        row = self.rows[idx]
        src_ids = self.vocab.encode(row["input"]) + [self.vocab.eos_idx]
        tgt_ids = [self.vocab.sos_idx] + self.vocab.encode(row["output"]) + [self.vocab.eos_idx]
        return {
            "src": torch.tensor(src_ids, dtype=torch.long),
            "tgt": torch.tensor(tgt_ids, dtype=torch.long),
        }


def collate_batch(batch: list[dict[str, torch.Tensor]], pad_idx: int) -> dict[str, torch.Tensor]:
    src = [item["src"] for item in batch]
    tgt = [item["tgt"] for item in batch]
    src_padded = pad_sequence(src, batch_first=True, padding_value=pad_idx)
    tgt_padded = pad_sequence(tgt, batch_first=True, padding_value=pad_idx)
    return {
        "src": src_padded,
        "tgt": tgt_padded,
        "src_lengths": torch.tensor([len(s) for s in src], dtype=torch.long),
        "tgt_lengths": torch.tensor([len(t) for t in tgt], dtype=torch.long),
    }


def load_jsonl(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows
