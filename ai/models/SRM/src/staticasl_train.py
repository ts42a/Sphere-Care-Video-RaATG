from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import torch
from torch import nn
from torch.utils.data import DataLoader

from dataset import SentenceRefinerDataset, Vocab, collate_batch, load_jsonl
from model import GRUSeq2Seq, Seq2SeqConfig
from vocab import build_vocab


def seed_everything(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def compute_loss(logits: torch.Tensor, tgt: torch.Tensor, criterion: nn.Module) -> torch.Tensor:
    target = tgt[:, 1:]
    return criterion(logits.reshape(-1, logits.size(-1)), target.reshape(-1))


@torch.no_grad()
def evaluate(model: GRUSeq2Seq, loader: DataLoader, criterion: nn.Module, device: torch.device) -> float:
    model.eval()
    total = 0.0
    count = 0
    for batch in loader:
        src = batch["src"].to(device)
        tgt = batch["tgt"].to(device)
        logits = model(src, tgt, teacher_forcing_ratio=0.0)
        loss = compute_loss(logits, tgt, criterion)
        total += float(loss.item())
        count += 1
    return total / max(1, count)


def main() -> None:
    parser = argparse.ArgumentParser(description="Train SRM on static ASL-special dataset.")
    parser.add_argument("--data_dir", type=str, default="ai/models/SRM/data/staticAsl")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch_size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--teacher_forcing_ratio", type=float, default=0.45)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    seed_everything(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    data_dir = Path(args.data_dir)
    train_path = data_dir / "train.jsonl"
    val_path = data_dir / "val.jsonl"
    if not train_path.exists() or not val_path.exists():
        raise FileNotFoundError(f"Missing dataset split files in {data_dir}. Run staticasl_dataset.py first.")

    train_rows = load_jsonl(train_path)
    val_rows = load_jsonl(val_path)

    vocab_dict = build_vocab(train_rows, min_freq=1)
    vocab_payload = {
        "special_tokens": ["<pad>", "<sos>", "<eos>", "<unk>"],
        "stoi": vocab_dict,
        "itos": [tok for tok, _ in sorted(vocab_dict.items(), key=lambda x: x[1])],
        "size": len(vocab_dict),
    }
    vocab_path = data_dir / "staticasl_vocab.json"
    vocab_path.write_text(json.dumps(vocab_payload, indent=2), encoding="utf-8")
    vocab = Vocab.from_json(vocab_path)

    train_ds = SentenceRefinerDataset(train_rows, vocab)
    val_ds = SentenceRefinerDataset(val_rows, vocab)
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, collate_fn=lambda b: collate_batch(b, vocab.pad_idx))
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, collate_fn=lambda b: collate_batch(b, vocab.pad_idx))

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
    criterion = nn.CrossEntropyLoss(ignore_index=vocab.pad_idx)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)

    ckpt_dir = data_dir / "checkpoints"
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    best_val = float("inf")
    history: list[dict[str, float]] = []

    for epoch in range(1, args.epochs + 1):
        model.train()
        total = 0.0
        count = 0
        for batch in train_loader:
            src = batch["src"].to(device)
            tgt = batch["tgt"].to(device)
            optimizer.zero_grad()
            logits = model(src, tgt, teacher_forcing_ratio=args.teacher_forcing_ratio)
            loss = compute_loss(logits, tgt, criterion)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total += float(loss.item())
            count += 1
        train_loss = total / max(1, count)
        val_loss = evaluate(model, val_loader, criterion, device)
        history.append({"epoch": float(epoch), "train_loss": train_loss, "val_loss": val_loss})
        torch.save({"model_state_dict": model.state_dict(), "epoch": epoch, "val_loss": val_loss}, ckpt_dir / f"epoch_{epoch:02d}.pt")
        if val_loss < best_val:
            best_val = val_loss
            torch.save({"model_state_dict": model.state_dict(), "epoch": epoch, "val_loss": val_loss}, ckpt_dir / "best.pt")
        print(f"Epoch {epoch}/{args.epochs} | train_loss={train_loss:.4f} | val_loss={val_loss:.4f}")

    (data_dir / "training_history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
    print(f"Training complete. best_val_loss={best_val:.4f}")
    print(f"Vocab: {vocab_path}")
    print(f"Best checkpoint: {ckpt_dir / 'best.pt'}")


if __name__ == "__main__":
    main()
