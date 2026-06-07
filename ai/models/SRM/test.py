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


_MOTION_NOISE = frozenset({"NO_HAND", "UNKNOWN", "CAPTURING", ""})
_SRM_WINDOW = 3
_SRM_SHORT_MIN = 2

# Fixed English for single-sign flushes (motion label is already confident).
_ATOMIC_LABELS: dict[str, str] = {
    "yes": "Yes.",
    "no": "No.",
    "ok": "Okay.",
    "please": "Please.",
    "thankyou": "Thank you.",
}

# Single-word closers: use _ATOMIC_LABELS or one-word SRM predict.
_ATOMIC_CLOSERS = frozenset(
    {
        "yes",
        "no",
        "ok",
        "please",
        "thankyou",
        "hungry",
        "happy",
        "nothing",
        "great",
    }
)

# Two-word minimum before commit on these closers.
_SHORT_CLOSERS = frozenset(
    {
        "deaf",
        "name",
        "what",
        "you",
        "your",
    }
)

# Motion signs that SRM can translate alone (one segment = one word).
_MOTION_SINGLE_OK = frozenset(
    {
        "help",
        "water",
        "busy",
        "drink",
        "hungry",
        "happy",
        "nothing",
        "great",
        "fine",
        "sad",
        "sorry",
        "goodbye",
        "bye",
        "seeyoulater",
        "later",
        "deaf",
        "ok",
        "please",
        "thankyou",
        "yes",
        "no",
    }
)

# Need surrounding signs before committing (e.g. lone "i" is not a phrase).
_CONTEXT_CLOSERS = frozenset({"i", "you", "your", "name", "what"})


def is_complete_sentence(text: str) -> bool:
    t = (text or "").strip()
    if not t or t[-1] not in ".?!":
        return False
    letters = sum(1 for ch in t if ch.isalpha())
    if letters < 2:
        return False
    words = [w for w in re.split(r"[\s,.!?]+", t) if w and any(c.isalpha() for c in w)]
    if len(words) == 1:
        return True
    return letters >= 5 and len(words) >= 2


class MotionSrmStream:
    """
    Motion words -> Translation with **display only on complete sentences**.

    Each new word is appended; the full word list and 3-word tail are checked internally.
    Translation commits on phrase closers; word buffer resets after each commit so the next
    phrase does not inherit stale signs. Atomic single-sign labels use a fixed English map.
    """

    _GREETING_CORE = frozenset({"hello", "howareyou"})
    _GOODBYE = frozenset({"seeyoulater", "later", "goodbye", "bye"})

    _CLOSERS = frozenset(
        {
            "i",
            "fine",
            "help",
            "water",
            "drink",
            "busy",
            "thankyou",
            "seeyoulater",
            "later",
            "goodbye",
            "bye",
            "sad",
            "sorry",
            "yes",
            "no",
            "ok",
            "please",
            "hungry",
            "happy",
            "deaf",
            "name",
            "what",
            "you",
            "your",
            "hello",
            "howareyou",
            "nothing",
            "great",
        }
    )

    def __init__(self, tester: TextModelTester | None = None) -> None:
        self._tester = tester or TextModelTester(mode="motion")
        self._words: list[str] = []
        self._session_words: list[str] = []
        self._display = ""
        self._commit_offset = 0
        self._full_candidate = ""

    def clear(self) -> None:
        self._words.clear()
        self._session_words.clear()
        self._display = ""
        self._commit_offset = 0
        self._full_candidate = ""

    @staticmethod
    def _accept_word(word: str) -> str:
        w = str(word).strip().lower()
        if not w or w.upper() in _MOTION_NOISE:
            return ""
        return w

    @staticmethod
    def _parse_words(text_buffer: str) -> list[str]:
        out: list[str] = []
        for raw in (text_buffer or "").split():
            w = MotionSrmStream._accept_word(raw)
            if not w:
                continue
            if out and out[-1] == w:
                continue
            out.append(w)
        return out

    @staticmethod
    def _first_clause_only(text: str) -> str:
        t = (text or "").strip()
        if not t:
            return t
        q = t.find("?")
        if q >= 0:
            tail = t[q + 1 :].strip()
            if tail:
                return t[: q + 1].strip()
        dot = t.find(". ")
        if dot > 0:
            return t[: dot + 1].strip()
        return t

    def _predict_phrase(self, srm_input: str) -> str:
        raw = self._tester.predict(srm_input.strip()).strip()
        return raw if is_complete_sentence(raw) else ""

    @classmethod
    def _min_words_for_close(cls, last: str, words: list[str] | None = None) -> int:
        wset = set(words or [])
        n = len(words or [])
        if last in _ATOMIC_CLOSERS:
            return 1
        if last in _SHORT_CLOSERS:
            return _SRM_SHORT_MIN
        if last in ("fine", "sad", "sorry"):
            return 1
        if words and words[0] == "help":
            if last == "help" and n == 1:
                return 1
            if last in ("water", "drink", "busy", "deaf", "i") and n >= 2:
                return _SRM_SHORT_MIN
            if n >= 3:
                return _SRM_WINDOW
            return _SRM_SHORT_MIN
        if n == 1 and last in _MOTION_SINGLE_OK:
            return 1
        if n == 1 and last in _CONTEXT_CLOSERS:
            return _SRM_WINDOW
        if last == "i" and "howareyou" in wset:
            return _SRM_SHORT_MIN
        return _SRM_WINDOW

    def _finalize_commit(self, candidate: str, words: list[str]) -> str:
        """Append fine/sad/sorry to the previous translation when they start a new phrase."""
        if not self._display or not candidate:
            return candidate
        last = words[-1]
        if last not in ("fine", "sad", "sorry"):
            return candidate
        if len(words) > 2:
            return candidate
        if candidate.lower() in self._display.lower():
            return self._display
        return f"{self._display.rstrip()} {candidate}".strip()

    def _atomic_translation(self, word: str) -> str:
        fixed = _ATOMIC_LABELS.get(word)
        if fixed:
            return fixed
        if word in _ATOMIC_CLOSERS:
            return self._predict_phrase(word)
        return ""

    def _check_full_word_list(self, words: list[str]) -> str:
        """Run SRM on the entire current phrase (internal check after each append)."""
        if not words:
            return ""
        if len(words) == 1:
            return self._atomic_translation(words[0])
        if len(words) == 2:
            return self._predict_phrase(" ".join(words))
        return self._predict_phrase(" ".join(words))

    def _greeting_clause(self, words: list[str]) -> str:
        wset = set(words)
        if self._GREETING_CORE.issubset(wset):
            if "fine" in wset:
                return self._predict_phrase("hello howareyou fine")
            if "i" in wset:
                raw = self._predict_phrase("hello howareyou i")
                if not raw:
                    return ""
                return raw if "fine" in wset else self._first_clause_only(raw)
        if "howareyou" in wset and "i" in wset:
            raw = self._predict_phrase("hello howareyou i")
            return self._first_clause_only(raw) if raw else ""
        return ""

    def _help_clause(self, words: list[str]) -> str:
        if "help" not in words:
            return ""
        if "deaf" in words:
            t = self._predict_phrase("i deaf help")
            if t:
                return t
        if "water" in words:
            t = self._predict_phrase("i help water")
            if t:
                return t
        if "drink" in words:
            t = self._predict_phrase("i help drink")
            if t:
                return t
        return self._predict_phrase("need help") or self._predict_phrase("pls help me")

    def _goodbye_clause(self, words: list[str]) -> str:
        if not any(w in words for w in self._GOODBYE):
            return ""
        return self._predict_phrase("seeyoulater")

    def _phrase_closed_by_last(self, words: list[str]) -> bool:
        """Newest sign finished a phrase — OK to evaluate a full sentence."""
        if not words:
            return False
        last = words[-1]
        if last not in self._CLOSERS:
            return False
        # HELP-first phrases: avoid "I need help." while the resident is still signing.
        if words[0] == "help":
            wset = set(words)
            if "howareyou" in wset:
                if last == "i":
                    return len(words) >= 4
                if last in ("sad", "sorry", "fine"):
                    return len(words) >= 3
                return False
            if len(words) == 2 and last == "i" and self._display and "howareyou" not in wset:
                return True
            if last in ("water", "drink", "busy") and len(words) >= 2:
                return True
        return len(words) >= self._min_words_for_close(last, words)

    def _compose_display(self, words: list[str]) -> str:
        if not words:
            return ""
        last = words[-1]
        if len(words) < self._min_words_for_close(last, words):
            return ""

        if len(words) == 1 and last in _ATOMIC_CLOSERS:
            t = self._atomic_translation(last)
            return t if is_complete_sentence(t) else ""

        if len(words) == 1 and last in ("fine", "sad", "sorry"):
            t = self._predict_phrase(last) or self._predict_phrase(f"i {last}")
            return t if is_complete_sentence(t) else ""

        if len(words) < _SRM_WINDOW:
            t = self._predict_phrase(" ".join(words))
            return t if is_complete_sentence(t) else ""

        parts: list[str] = []
        wset = set(words)

        g = self._greeting_clause(words)
        if g and ({"i", "fine"} & wset):
            parts.append(g)
        if "help" in wset and last == "help":
            h = self._help_clause(words)
            if h:
                parts.append(h)
        elif (
            "help" in wset
            and last == "i"
            and len(words) == 2
            and not self._GREETING_CORE.intersection(wset)
        ):
            h = self._help_clause(words)
            if h:
                parts.append(h)
        if any(w in wset for w in self._GOODBYE) and last in self._GOODBYE:
            b = self._goodbye_clause(words)
            if b:
                parts.append(b)
        if last in ("sad", "sorry"):
            t = self._predict_phrase(" ".join(words[-_SRM_WINDOW:]))
            if t:
                if not parts:
                    parts.append(t)
                elif t.lower() not in " ".join(parts).lower():
                    parts.append(t)
        if not parts:
            t = self._predict_phrase(" ".join(words[-_SRM_WINDOW:]))
            if t:
                parts.append(t)
        joined = " ".join(parts).strip()
        return joined if is_complete_sentence(joined) else ""

    def _merge_display(self, clause: str, full: str, words: list[str]) -> str:
        """Pick best translation from clause rules vs full-list SRM."""
        clause = (clause or "").strip()
        full = (full or "").strip()
        if not clause and not full:
            return ""
        if not full:
            return clause
        if not clause:
            return full

        last = words[-1]
        wset = set(words)
        full_lower = full.lower()
        clause_lower = clause.lower()

        # Full list often says "I need help." when help was signed mid-phrase but user closed on i/sad/etc.
        if "help" in wset and last not in ("help", "water", "drink"):
            if "need help" in full_lower and "need help" not in clause_lower:
                return clause

        # Clause strips premature "I am here." from greeting; keep that over raw full-list output.
        if (
            self._GREETING_CORE.intersection(wset)
            and "i am here" in full_lower
            and "i am here" not in clause_lower
            and clause_lower.startswith(("hello", "hi"))
        ):
            if last in ("sad", "sorry") and len(clause) > len(full):
                return clause
            if last in ("i", "fine", "thankyou"):
                return clause

        # Full list adds thank-you / goodbye / water context the clause builder missed.
        if is_complete_sentence(full) and len(full) > len(clause):
            if last in ("sad", "sorry") and clause.count(".") >= full.count("."):
                return clause
            return full

        return clause if is_complete_sentence(clause) else full

    def _run_internal_checks(self, words: list[str]) -> None:
        """After each append: check full phrase + 3-word tail (no display update)."""
        self._full_candidate = self._check_full_word_list(words)
        if len(words) >= _SRM_WINDOW:
            self._predict_phrase(" ".join(words[-_SRM_WINDOW:]))

    def _apply_commit(self, candidate: str, words: list[str], *, all_words: list[str]) -> None:
        merged = self._finalize_commit(candidate, words)
        if not is_complete_sentence(merged):
            return
        prev = self._display
        if not prev:
            self._display = merged
        elif merged == prev:
            pass
        elif merged.startswith(prev.rstrip()) or prev.rstrip() in merged:
            self._display = merged
        elif merged.lower() not in prev.lower():
            self._display = f"{prev.rstrip()} {merged}".strip()
        self._commit_offset = len(all_words)
        self._words = []
        self._full_candidate = ""
        self._session_words = list(all_words)

    def sync_from_buffer(self, text_buffer: str) -> str:
        all_words = self._parse_words(text_buffer)
        if not all_words:
            self._words.clear()
            self._full_candidate = ""
            return self._display

        if self._commit_offset > len(all_words):
            self._commit_offset = 0

        words = all_words[self._commit_offset :]
        self._words = words
        self._session_words = list(all_words)
        self._run_internal_checks(words)
        if not self._phrase_closed_by_last(words):
            return self._display
        clause = self._compose_display(words)
        candidate = self._merge_display(clause, self._full_candidate, words)
        if not is_complete_sentence(candidate):
            return self._display
        self._apply_commit(candidate, words, all_words=all_words)
        return self._display

    def add_word(self, word: str) -> str:
        w = self._accept_word(word)
        if not w:
            return self._display
        if not self._session_words or self._session_words[-1] != w:
            self._session_words.append(w)
        return self.sync_from_buffer(" ".join(self._session_words))

    @property
    def translation(self) -> str:
        return self._display

    @property
    def word_list(self) -> list[str]:
        return list(self._words)

    @property
    def session_text(self) -> str:
        return " ".join(self._session_words)

    @property
    def text_stream(self) -> str:
        return " ".join(self._words)


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
    parser.add_argument(
        "--stream",
        action="store_true",
        help="Motion sliding-window mode: one word per line; shows word list + translation.",
    )
    args = parser.parse_args()

    tester = TextModelTester(checkpoint=args.checkpoint, vocab=args.vocab, mode=args.mode)
    if args.text:
        print(tester.predict(args.text))
        return

    if args.stream or args.mode == "motion":
        stream = MotionSrmStream(tester)
        print("Motion stream mode. Enter one word (or several separated by spaces).")
        print("Commands: clear, exit")
        while True:
            user_in = input("word> ").strip()
            if not user_in:
                continue
            low = user_in.lower()
            if low in {"exit", "quit"}:
                break
            if low == "clear":
                stream.clear()
                print("text> -")
                print("translation> -")
                continue
            for tok in user_in.split():
                stream.add_word(tok)
            text = stream.session_text or "-"
            trans = stream.translation or "-"
            print(f"text> {text}")
            print(f"translation> {trans}")
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
