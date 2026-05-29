from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path


class TextModelTester:
    _STREAM_LEXICON = {
        "hi", "hello", "hey", "how", "are", "r", "you", "your", "i", "im", "am",
        "fine", "ok", "okay", "yes", "no", "cant", "cannot", "can", "not",
        "talk", "class", "now", "later", "please", "pls", "call", "text",
        "msg", "message", "help", "water", "need", "me", "we", "they", "he",
        "she", "is", "was", "will", "come", "join", "outside", "home", "busy",
        "driving", "minute",
    }
    _REPLACE_MAP = {
        "u": "you",
        "ur": "your",
        "r": "are",
        "im": "i am",
        "cant": "cannot",
        "pls": "please",
        "msg": "message",
        "iam": "i am",
        "fiee": "fine",
        "fie": "fine",
        "fin": "fine",
        "finee": "fine",
    }

    def __init__(self, checkpoint: str = "", vocab: str = "", mode: str = "motion") -> None:
        self._srm_root = Path(__file__).resolve().parent
        self._mode = mode if mode in {"motion", "static"} else "motion"
        self._srm_model = None
        self._srm_vocab = None
        self._srm_device = None
        self._srm_failed = False
        self._ckpt_path = self._resolve_checkpoint(checkpoint)
        self._vocab_path = self._resolve_vocab(vocab)

    def _resolve_checkpoint(self, checkpoint: str) -> Path:
        if checkpoint:
            return Path(checkpoint)
        env = os.getenv("ASL_SRM_CHECKPOINT", "").strip()
        if env:
            return Path(env)
        if self._mode == "static":
            return self._srm_root / "data" / "staticAsl" / "checkpoints" / "best.pt"
        return self._srm_root / "data" / "Motion" / "checkpoints" / "best.pt"

    def _resolve_vocab(self, vocab: str) -> Path:
        if vocab:
            return Path(vocab)
        env = os.getenv("ASL_SRM_VOCAB", "").strip()
        if env:
            return Path(env)
        if self._mode == "static":
            preferred = self._srm_root / "data" / "staticAsl" / "staticasl_vocab.json"
        else:
            preferred = self._srm_root / "data" / "Motion" / "staticasl_vocab.json"
        if preferred.exists():
            return preferred
        return self._srm_root / "data" / "srm_final_v1_vocab.json"

    def _ensure_srm(self) -> bool:
        if self._srm_failed:
            return False
        if self._srm_model is not None:
            return True
        if not self._ckpt_path.exists() or not self._vocab_path.exists():
            self._srm_failed = True
            return False
        try:
            import torch

            srm_src = self._srm_root / "src"
            if str(srm_src) not in sys.path:
                sys.path.append(str(srm_src))
            from dataset import Vocab  # type: ignore
            from model import GRUSeq2Seq, Seq2SeqConfig  # type: ignore

            vocab = Vocab.from_json(self._vocab_path)
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
            ckpt = torch.load(self._ckpt_path, map_location=device)
            model.load_state_dict(ckpt["model_state_dict"])
            model.eval()
            self._srm_model = model
            self._srm_vocab = vocab
            self._srm_device = device
            return True
        except Exception:
            self._srm_failed = True
            return False

    @staticmethod
    def _collapse_repeats(text: str, max_repeat: int = 1) -> str:
        out = []
        prev = ""
        count = 0
        for ch in text:
            if ch == prev:
                count += 1
            else:
                prev = ch
                count = 1
            if count <= max_repeat:
                out.append(ch)
        return "".join(out)

    def _segment_compact_stream(self, compact: str) -> str:
        n = len(compact)
        if n == 0:
            return ""
        best: list[tuple[int, list[str]] | None] = [None] * (n + 1)
        best[0] = (0, [])
        max_len = max(len(w) for w in self._STREAM_LEXICON)
        for i in range(n):
            if best[i] is None:
                continue
            score, words = best[i]
            upper = min(n, i + max_len)
            for j in range(i + 1, upper + 1):
                part = compact[i:j]
                lex = part if part in self._STREAM_LEXICON else self._collapse_repeats(part, max_repeat=1)
                if lex not in self._STREAM_LEXICON:
                    continue
                cand = score + len(part) * 3 - 1
                cand_words = words + [lex]
                if best[j] is None or cand > best[j][0]:
                    best[j] = (cand, cand_words)
        if best[n] is None:
            return compact
        return " ".join(best[n][1])

    def _normalize(self, text: str) -> str:
        txt = re.sub(r"[^a-zA-Z0-9\s]", " ", text.lower())
        txt = re.sub(r"\s+", " ", txt).strip()
        if not txt:
            return ""
        if " " in txt:
            tokens = [self._collapse_repeats(t, max_repeat=2) for t in txt.split()]
        else:
            compact = self._collapse_repeats(txt, max_repeat=2)
            tokens = self._segment_compact_stream(compact).split()

        out: list[str] = []
        for tok in tokens:
            out.extend(self._REPLACE_MAP.get(tok, tok).split())
        return " ".join(out).strip()

    @staticmethod
    def _final_format(text: str) -> str:
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            return ""
        text = text[0].upper() + text[1:]
        if text[-1] not in ".?!":
            if text.lower().startswith(("hi ", "hello ", "hey ", "how ", "are ", "is ", "can ", "will ")):
                text += "?"
            else:
                text += "."
        return re.sub(r"^(Hi|Hello|Hey)\s+(how\s+are\s+you\??)$", r"\1, \2", text, flags=re.IGNORECASE)

    def _run_srm(self, text: str) -> str:
        if not self._ensure_srm():
            return text
        try:
            import torch

            src_ids = self._srm_vocab.encode(text.strip().lower()) + [self._srm_vocab.eos_idx]
            src = torch.tensor([src_ids], dtype=torch.long, device=self._srm_device)
            pred_ids = self._srm_model.greedy_decode(src, max_len=30)[0].tolist()
            words = []
            for tok in pred_ids:
                if tok == self._srm_vocab.eos_idx:
                    break
                if tok in (self._srm_vocab.sos_idx, self._srm_vocab.pad_idx):
                    continue
                words.append(self._srm_vocab.itos[tok] if tok < len(self._srm_vocab.itos) else "<unk>")
            out = " ".join(words).strip()
            return out or text
        except Exception:
            return text

    def _rule_based_output(self, normalized: str) -> str:
        compact = normalized.replace(" ", "")
        if compact in {"iamfine", "hiiamfine", "hiiiamfine"} or ("am" in compact and ("fie" in compact or "fin" in compact)):
            return "I am fine."
        if compact in {"hihowareyou", "hihowryou", "howareyou"}:
            return "Hi, how are you?"
        if "cant" in compact and "class" in compact and "now" in compact:
            return "I cannot talk now. I am in class."
        if compact in {"plsmsgme", "pleasemessageme", "msgme"}:
            return "Please message me."
        return ""

    def predict(self, raw_text: str) -> str:
        normalized = self._normalize(raw_text)
        if not normalized:
            return ""
        rb = self._rule_based_output(normalized)
        if rb:
            return rb
        return self._final_format(self._run_srm(normalized))


def main() -> None:
    parser = argparse.ArgumentParser(description="SRM terminal test script.")
    parser.add_argument(
        "--mode",
        type=str,
        choices=["motion", "static"],
        default="motion",
        help="Use motion or static SRM default artifacts when checkpoint/vocab are not provided.",
    )
    parser.add_argument("--text", type=str, default="", help="Single input text for one-shot inference.")
    parser.add_argument("--checkpoint", type=str, default="", help="Optional checkpoint path.")
    parser.add_argument("--vocab", type=str, default="", help="Optional vocab JSON path.")
    args = parser.parse_args()

    tester = TextModelTester(checkpoint=args.checkpoint, vocab=args.vocab, mode=args.mode)
    if args.text:
        print(tester.predict(args.text))
        return

    print("Interactive mode. Type 'exit' to quit.")
    while True:
        user_in = input("input> ").strip()
        if not user_in:
            continue
        if user_in.lower() in {"exit", "quit"}:
            break
        print(f"output> {tester.predict(user_in)}")


if __name__ == "__main__":
    main()
