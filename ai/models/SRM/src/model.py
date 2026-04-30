from __future__ import annotations

import random
from dataclasses import dataclass

import torch
from torch import nn


@dataclass
class Seq2SeqConfig:
    vocab_size: int
    pad_idx: int
    sos_idx: int
    eos_idx: int
    embed_dim: int = 128
    hidden_dim: int = 256
    num_layers: int = 1
    dropout: float = 0.1


class GRUSeq2Seq(nn.Module):
    def __init__(self, cfg: Seq2SeqConfig) -> None:
        super().__init__()
        self.cfg = cfg
        self.embedding = nn.Embedding(cfg.vocab_size, cfg.embed_dim, padding_idx=cfg.pad_idx)
        self.encoder = nn.GRU(
            input_size=cfg.embed_dim,
            hidden_size=cfg.hidden_dim,
            num_layers=cfg.num_layers,
            dropout=cfg.dropout if cfg.num_layers > 1 else 0.0,
            batch_first=True,
        )
        self.decoder = nn.GRU(
            input_size=cfg.embed_dim,
            hidden_size=cfg.hidden_dim,
            num_layers=cfg.num_layers,
            dropout=cfg.dropout if cfg.num_layers > 1 else 0.0,
            batch_first=True,
        )
        self.dropout = nn.Dropout(cfg.dropout)
        self.output = nn.Linear(cfg.hidden_dim, cfg.vocab_size)

    def forward(self, src: torch.Tensor, tgt: torch.Tensor, teacher_forcing_ratio: float = 0.5) -> torch.Tensor:
        """
        src: [B, S]
        tgt: [B, T] includes <sos> ... <eos>
        returns logits: [B, T-1, V] for predicting tgt[:, 1:]
        """
        batch_size, tgt_len = tgt.shape
        vocab_size = self.cfg.vocab_size

        src_emb = self.dropout(self.embedding(src))
        _, hidden = self.encoder(src_emb)

        outputs = torch.zeros(batch_size, tgt_len - 1, vocab_size, device=src.device)
        decoder_input = tgt[:, 0].unsqueeze(1)  # <sos>
        decoder_hidden = hidden

        for t in range(1, tgt_len):
            dec_emb = self.dropout(self.embedding(decoder_input))
            dec_out, decoder_hidden = self.decoder(dec_emb, decoder_hidden)
            logits = self.output(dec_out.squeeze(1))
            outputs[:, t - 1, :] = logits

            use_teacher = random.random() < teacher_forcing_ratio
            next_token = tgt[:, t] if use_teacher else torch.argmax(logits, dim=1)
            decoder_input = next_token.unsqueeze(1)

        return outputs

    @torch.no_grad()
    def greedy_decode(self, src: torch.Tensor, max_len: int = 30) -> torch.Tensor:
        """
        src: [B, S]
        returns token ids [B, <=max_len] excluding <sos>, ending with/without <eos>
        """
        src_emb = self.embedding(src)
        _, hidden = self.encoder(src_emb)

        batch_size = src.size(0)
        decoder_input = torch.full((batch_size, 1), self.cfg.sos_idx, device=src.device, dtype=torch.long)
        decoder_hidden = hidden
        generated: list[torch.Tensor] = []

        for _ in range(max_len):
            dec_emb = self.embedding(decoder_input)
            dec_out, decoder_hidden = self.decoder(dec_emb, decoder_hidden)
            logits = self.output(dec_out.squeeze(1))
            next_tok = torch.argmax(logits, dim=1)  # [B]
            generated.append(next_tok)
            decoder_input = next_tok.unsqueeze(1)

        return torch.stack(generated, dim=1)
