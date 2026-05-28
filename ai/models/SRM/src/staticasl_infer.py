from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from dataset import Vocab
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


def load_model(vocab_path: Path, checkpoint_path: Path, device: torch.device) -> tuple[GRUSeq2Seq, Vocab]:
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
    model = GRUSeq2Seq(cfg).to(device)
    ckpt = torch.load(checkpoint_path, map_location=device)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    return model, vocab


@torch.no_grad()
def refine_text(model: GRUSeq2Seq, vocab: Vocab, text: str, device: torch.device, max_len: int = 30) -> str:
    src_ids = vocab.encode(text.strip().lower()) + [vocab.eos_idx]
    src = torch.tensor([src_ids], dtype=torch.long, device=device)
    pred_ids = model.greedy_decode(src, max_len=max_len)[0].tolist()
    return decode_tokens(pred_ids, vocab)


def main() -> None:
    srm_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Static ASL SRM inference CLI.")
    parser.add_argument("--vocab_path", type=str, default=str(srm_root / "data" / "staticAsl" / "staticasl_vocab.json"))
    parser.add_argument("--checkpoint_path", type=str, default=str(srm_root / "data" / "staticAsl" / "checkpoints" / "best.pt"))
    parser.add_argument("--text", type=str, default="")
    parser.add_argument("--max_len", type=int, default=30)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model, vocab = load_model(Path(args.vocab_path), Path(args.checkpoint_path), device)

    if args.text:
        refined = refine_text(model, vocab, args.text, device, max_len=args.max_len)
        if args.json:
            print(json.dumps({"input": args.text, "output": refined}, ensure_ascii=False))
        else:
            print(refined)
        return

    print("StaticASL SRM interactive mode. Type 'exit' to quit.")
    while True:
        user_in = input("rough> ").strip()
        if not user_in:
            continue
        if user_in.lower() in {"exit", "quit"}:
            break
        out = refine_text(model, vocab, user_in, device, max_len=args.max_len)
        print(f"clean> {out}")


if __name__ == "__main__":
    main()
