# SR — Sentence Refiner (SRM)

SRM is a GRU seq2seq project for rewriting rough chat/transcript text into clean English while preserving meaning.

## Goal

Convert short noisy chat text into clean output suitable for live video call transcript display.

Examples:
- `how doing` -> `How are you doing?`
- `i fine you` -> `I am fine, and you?`
- `cant talk class now` -> `I cannot talk now. I am in class.`

## Scope and Boundaries (Day 1)

- Language: English only.
- Input: short rough chat text.
- Output: natural, grammatical, punctuated short English.
- Primary rule: do not change meaning.
- Sequence limits (v1):
  - max input: 20 tokens
  - max output: 30 tokens
- Out of scope for v1:
  - long paragraphs
  - technical writing
  - uncommon slang-heavy dialects

## Dataset Versions (Day 2)

The following files are maintained in `ai/models/SRM/data`:

- `all_2500.jsonl`: base 2000 + added 500 pairs.
- `added_500.jsonl`: the added 500 pairs only.
- `train.jsonl`, `val.jsonl`, `test.jsonl`: 80/10/10 split from `all_2500.jsonl`.

Requested alias names:
- `v1_data_2500.jsonl` = `all_2500.jsonl`
- `V1.1_data25K_A0.5k.jsonl` = `all_2500.jsonl`
- `v1.1_A0.5K.jsonl` = `added_500.jsonl`

## Preprocessing + Vocabulary (Day 3)

Implemented in:
- `src/preprocess.py`
- `src/vocab.py`

### Preprocessing behavior
- Input normalization:
  - lowercasing
  - trim and collapse spaces
- Output normalization:
  - trim and collapse spaces
  - capitalize first character
  - ensure ending punctuation (`.`, `?`, `!`)

Run:

```bash
python ai/models/SRM/src/preprocess.py --input ai/models/SRM/data/train.jsonl --output ai/models/SRM/data/train.clean.jsonl
```

### Vocabulary behavior
- Word-level tokenization (`split()`).
- Special tokens:
  - `<pad>`, `<sos>`, `<eos>`, `<unk>`
- Builds from train set and writes vocab JSON.

Run:

```bash
python ai/models/SRM/src/vocab.py --train_path ai/models/SRM/data/train.clean.jsonl --output_path ai/models/SRM/data/vocab.json --min_freq 1
```

## Dataset + Loader Pipeline (Day 4)

Implemented in:
- `src/dataset.py`

Includes:
- `Vocab` loader/encoder
- `SentenceRefinerDataset`:
  - source encoded with `<eos>`
  - target encoded with `<sos>` ... `<eos>`
- `collate_batch` with dynamic padding and length tensors

This is ready for Day 5 model wiring (`model.py` and `train.py`).

## Day 5 — GRU Seq2Seq Model

Implemented in:
- `src/model.py`

Architecture:
- embedding
- encoder GRU
- decoder GRU
- linear projection to vocab logits

Config (v1 default):
- embed dim: 128
- hidden dim: 256
- encoder layers: 1
- decoder layers: 1
- dropout: 0.1

Teacher forcing:
- supported in `forward(..., teacher_forcing_ratio=...)`
- configurable from training CLI

## Day 6 — Tiny Overfit Test

Implemented in:
- `src/train.py` (`--run_tiny_overfit`)

Outputs:
- `samples/overfit_log.md`
- `samples/overfit_predictions.json`

Purpose:
- verify decoder shifting and loss masking
- check `<eos>` generation behavior
- catch teacher forcing wiring issues

## Day 7 — Full Training (v1)

Implemented in:
- `src/train.py`

What it does:
- smoke test (forward + loss)
- full training loop
- Adam optimizer (`lr=1e-3` default)
- CrossEntropyLoss with `ignore_index=<pad>`
- per-epoch checkpoint save
- best model save to `checkpoints/best.pt`
- per-epoch qualitative samples to `samples/epoch_outputs.md`

Generated artifacts:
- `checkpoints/<model_name>_epoch_XX.pt`
- `checkpoints/best.pt`
- `samples/epoch_outputs.md`
- `samples/training_history.json`

## Terminal Prompt Mode (Data + Model Name)

If you do not pass `--train_path/--val_path/--test_path` or `--model_name`, the script asks in terminal so you can choose dataset and model name.

Run:

```bash
python ai/models/SRM/src/train.py
```

Or explicit run:

```bash
python ai/models/SRM/src/train.py --train_path ai/models/SRM/data/train.jsonl --val_path ai/models/SRM/data/val.jsonl --test_path ai/models/SRM/data/test.jsonl --model_name srm_gru_v1 --epochs 20 --batch_size 32 --teacher_forcing_ratio 0.5
```

## Data Build Script

Use:

```bash
python ai/models/SRM/src/build_day2_dataset.py
```

It generates/refreshes:
- `all_2500.jsonl`
- `added_500.jsonl`
- `train.jsonl`
- `val.jsonl`
- `test.jsonl`
- version alias files listed above

No per-day report JSON file is kept.

## Day 9 — Improve Dataset from Errors

Implemented in:
- `src/improve_dataset.py`

This script reads failure examples from Day 8 and appends targeted corrections/variants to training data.

Run:

```bash
python ai/models/SRM/src/improve_dataset.py --base_train ai/models/SRM/data/hybrid_v1_5k_train.jsonl --failures_json ai/models/SRM/samples/day8_failure_examples_hybrid_v2.json --out_train ai/models/SRM/data/hybrid_v2_5kplus_train.jsonl --out_added ai/models/SRM/data/hybrid_v2_added_from_failures.jsonl --max_added 800
```

## Day 10 — Retrain Improved Model

Use improved Day 9 dataset and retrain with same validation/test split.

Run:

```bash
python -u ai/models/SRM/src/train.py --train_path ai/models/SRM/data/hybrid_v2_5kplus_train.jsonl --val_path ai/models/SRM/data/hybrid_v1_5k_val.jsonl --test_path ai/models/SRM/data/hybrid_v1_5k_test.jsonl --model_name srm_hybrid_v2plus --epochs 12 --batch_size 32 --lr 0.001 --teacher_forcing_ratio 0.45
```

Observed run summary:
- best validation loss: `0.0803`

## Day 11 — Inference App / CLI

Implemented in:
- `src/infer.py`

Supports:
- one-shot mode (`--text`)
- JSON output mode (`--json`)
- interactive terminal mode (no `--text`)

Examples:

```bash
python ai/models/SRM/src/infer.py --vocab_path ai/models/SRM/data/srm_hybrid_v2plus_vocab.json --checkpoint_path ai/models/SRM/checkpoints/best.pt --text "cant talk class now" --json
```

```bash
python ai/models/SRM/src/infer.py --vocab_path ai/models/SRM/data/srm_hybrid_v2plus_vocab.json --checkpoint_path ai/models/SRM/checkpoints/best.pt
```

## Day 12 — Final Evaluation + Presentation Outputs

Implemented in:
- `src/final_eval.py`

Outputs:
- `samples/final_eval_report.md`
- `samples/final_eval_predictions.json`

Run:

```bash
python ai/models/SRM/src/final_eval.py --eval_path ai/models/SRM/data/hybrid_v1_5k_test.jsonl --vocab_path ai/models/SRM/data/srm_hybrid_v2plus_vocab.json --checkpoint_path ai/models/SRM/checkpoints/best.pt --sample_count 100 --out_report ai/models/SRM/samples/final_eval_report.md --out_preds ai/models/SRM/samples/final_eval_predictions.json
```

Latest final-eval run:
- samples: `100`
- exact match: `78`
- exact match accuracy: `0.7800`

## SRM v1 Architecture Diagram

```text
Rough Chat Input
      |
  Tokenize + Encode
      |
   Embedding
      |
  Encoder GRU  ---- hidden ---->  Decoder GRU (teacher forcing during train)
      |                                |
      |                            Linear -> Vocab logits -> Greedy decode
      |                                |
      +---------------------------> Clean Sentence Output
```

## Strengths and Limits

Strengths:
- Strong grammar cleanup for short chat text.
- Good punctuation restoration in frequent patterns.
- Handles common shorthand (`u`, `im`, `cant`) well.

Limitations:
- Still over-expands on some timing/context phrases.
- Can drift tense on ambiguous compressed inputs.
- Long multi-clause slang remains harder than short turns.
