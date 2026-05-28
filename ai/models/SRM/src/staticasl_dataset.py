from __future__ import annotations

import argparse
import json
import random
import re
from pathlib import Path


def _elongate_word(word: str, rng: random.Random) -> str:
    out: list[str] = []
    for ch in word:
        reps = 1
        if ch.isalpha() and rng.random() < 0.45:
            reps = rng.randint(2, 5)
        out.append(ch * reps)
    return "".join(out)


def _compact(text: str) -> str:
    return text.replace(" ", "")


def _spaced_chars(text: str) -> str:
    chars = [c for c in text if c != " "]
    return " ".join(chars)


def _normalize_noise(text: str) -> str:
    t = text.strip().lower()
    t = re.sub(r"\s+", " ", t)
    return t


BASE_PAIRS: list[tuple[str, str]] = [
    ("hi how are you", "Hi, how are you?"),
    ("i am fine", "I am fine."),
    ("i am in class", "I am in class."),
    ("i cannot talk", "I cannot talk."),
    ("i cannot talk now", "I cannot talk now."),
    ("please call me", "Please call me."),
    ("please text me", "Please text me."),
    ("please message me", "Please message me."),
    ("i will call later", "I will call later."),
    ("i will message you later", "I will message you later."),
    ("can you help me", "Can you help me?"),
    ("i need water", "I need water."),
    ("i am outside", "I am outside."),
    ("i am at home", "I am at home."),
    ("i am busy now", "I am busy now."),
    ("just a minute", "Just a minute."),
    ("hello", "Hello."),
    ("yes", "Yes."),
    ("no", "No."),
    ("thank you", "Thank you."),
]

EXTRA_NOISY_ROWS: list[tuple[str, str]] = [
    ("hiiiiiammmfiee", "I am fine."),
    ("hiiiamfiee", "I am fine."),
    ("iamfine", "I am fine."),
    ("iiamfinee", "I am fine."),
    ("iamfinee", "I am fine."),
    ("iamfie", "I am fine."),
    ("iam fn", "I am fine."),
    ("hhhiihooowrrryoouu", "Hi, how are you?"),
    ("hihowryou", "Hi, how are you?"),
    ("hiii how r u", "Hi, how are you?"),
    ("canttalkclassnow", "I cannot talk now. I am in class."),
    ("cant talk class now", "I cannot talk now. I am in class."),
    ("plsmsgme", "Please message me."),
    ("msgme", "Message me."),
]


def build_rows(seed: int = 42, per_pair: int = 80) -> list[dict[str, str]]:
    rng = random.Random(seed)
    rows: list[dict[str, str]] = []
    shorthand = {
        "are": "r",
        "you": "u",
        "please": "pls",
        "message": "msg",
        "cannot": "cant",
    }

    for src, tgt in BASE_PAIRS:
        words = src.split()
        for _ in range(per_pair):
            mode = rng.choice(["clean", "elong", "compact", "spaced", "mix"])
            noisy_words = words[:]
            # Inject shorthand.
            for i, w in enumerate(noisy_words):
                if w in shorthand and rng.random() < 0.55:
                    noisy_words[i] = shorthand[w]
            noisy = " ".join(noisy_words)

            if mode == "elong":
                noisy = " ".join(_elongate_word(w, rng) for w in noisy.split())
            elif mode == "compact":
                noisy = _compact(noisy)
            elif mode == "spaced":
                noisy = _spaced_chars(noisy)
            elif mode == "mix":
                noisy = _compact(" ".join(_elongate_word(w, rng) for w in noisy.split()))

            rows.append({"input": _normalize_noise(noisy), "output": tgt})
            # keep a plain variant
            rows.append({"input": src, "output": tgt})

    for noisy, tgt in EXTRA_NOISY_ROWS:
        for _ in range(40):
            rows.append({"input": _normalize_noise(noisy), "output": tgt})

    # dedupe while preserving order
    seen: set[tuple[str, str]] = set()
    uniq: list[dict[str, str]] = []
    for r in rows:
        k = (r["input"], r["output"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(r)
    rng.shuffle(uniq)
    return uniq


def write_jsonl(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build static ASL-special SRM dataset.")
    parser.add_argument("--out_dir", type=str, default="ai/models/SRM/data/staticAsl")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--per_pair", type=int, default=80)
    args = parser.parse_args()

    rows = build_rows(seed=args.seed, per_pair=args.per_pair)
    n = len(rows)
    n_train = int(n * 0.8)
    n_val = int(n * 0.1)
    train_rows = rows[:n_train]
    val_rows = rows[n_train : n_train + n_val]
    test_rows = rows[n_train + n_val :]

    out_dir = Path(args.out_dir)
    write_jsonl(out_dir / "train.jsonl", train_rows)
    write_jsonl(out_dir / "val.jsonl", val_rows)
    write_jsonl(out_dir / "test.jsonl", test_rows)
    write_jsonl(out_dir / "all.jsonl", rows)

    print(
        json.dumps(
            {
                "out_dir": str(out_dir),
                "train": len(train_rows),
                "val": len(val_rows),
                "test": len(test_rows),
                "total": n,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
