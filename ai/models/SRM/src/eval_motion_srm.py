from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from dataset import Vocab, load_jsonl
from model import GRUSeq2Seq, Seq2SeqConfig


def decode_tokens(tokens: list[int], vocab: Vocab) -> str:
    words: list[str] = []
    for tok in tokens:
        if tok == vocab.eos_idx:
            break
        if tok in (vocab.sos_idx, vocab.pad_idx):
            continue
        words.append(vocab.itos[tok] if tok < len(vocab.itos) else "<unk>")
    text = " ".join(words).strip()
    if text and text[-1] not in ".?!":
        text += "."
    return text


def normalize_text(text: str) -> str:
    return " ".join(text.strip().lower().split())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate SRM model on Motion test split.")
    parser.add_argument("--data_dir", type=str, default="ai/models/SRM/data/Motion")
    parser.add_argument("--checkpoint_path", type=str, default="")
    parser.add_argument("--vocab_path", type=str, default="")
    parser.add_argument("--max_len", type=int, default=30)
    parser.add_argument("--out_json", type=str, default="")
    return parser.parse_args()


@torch.no_grad()
def main() -> None:
    args = parse_args()

    data_dir = Path(args.data_dir)
    test_path = data_dir / "test.jsonl"
    vocab_path = Path(args.vocab_path) if args.vocab_path else data_dir / "staticasl_vocab.json"
    checkpoint_path = (
        Path(args.checkpoint_path) if args.checkpoint_path else data_dir / "checkpoints" / "best.pt"
    )

    if not test_path.exists():
        raise FileNotFoundError(f"Test split not found: {test_path}")
    if not vocab_path.exists():
        raise FileNotFoundError(f"Vocab not found: {vocab_path}")
    if not checkpoint_path.exists():
        raise FileNotFoundError(f"Checkpoint not found: {checkpoint_path}")

    rows = load_jsonl(test_path)
    vocab = Vocab.from_json(vocab_path)

    cfg = Seq2SeqConfig(
        vocab_size=len(vocab.itos),
        pad_idx=vocab.pad_idx,
        sos_idx=vocab.sos_idx,
        eos_idx=vocab.eos_idx,
        embed_dim=128,
        hidden_dim=256,
        num_layers=1,
        dropout=0.1,
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = GRUSeq2Seq(cfg).to(device)
    ckpt = torch.load(checkpoint_path, map_location=device)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()

    predictions: list[dict[str, object]] = []
    exact_match = 0

    for row in rows:
        inp = row["input"]
        gold = row["output"]
        src_ids = vocab.encode(inp.strip().lower()) + [vocab.eos_idx]
        src = torch.tensor([src_ids], dtype=torch.long, device=device)
        pred_ids = model.greedy_decode(src, max_len=args.max_len)[0].tolist()
        pred = decode_tokens(pred_ids, vocab)
        ok = normalize_text(pred) == normalize_text(gold)
        exact_match += int(ok)
        predictions.append(
            {
                "input": inp,
                "gold": gold,
                "pred": pred,
                "exact_match": ok,
            }
        )

    total = len(rows)
    summary = {
        "samples": total,
        "exact_match": (exact_match / total) if total else 0.0,
        "checkpoint_path": str(checkpoint_path),
        "vocab_path": str(vocab_path),
        "test_path": str(test_path),
    }
    print(json.dumps(summary, indent=2))

    if args.out_json:
        out_path = Path(args.out_json)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(
                {
                    "summary": summary,
                    "predictions": predictions,
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        print(json.dumps({"saved": str(out_path)}, indent=2))


if __name__ == "__main__":
    main()

