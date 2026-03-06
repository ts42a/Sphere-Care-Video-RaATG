# train.py
# Train ASL gesture models from dataset_builder outputs.
# - Static model: SVM over 63D landmark vector
# - Motion model: baseline SVM over flattened padded sequence (seq_len*63)

import argparse
import json
from pathlib import Path

import numpy as np
import joblib

from sklearn.svm import SVC
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix


# ---------------- Paths (relative to THIS file) ----------------
ROOT = Path(__file__).resolve().parent  # ai/training/ai_transcript
DATASET_DIR = ROOT / "dataset" / "raw"
STATIC_DIR = DATASET_DIR / "static"
MOTION_DIR = DATASET_DIR / "motion"

ARTIFACTS_DIR = ROOT / "artifacts" / "gesture"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)


# ---------------- Helpers ----------------
def save_labels(path: Path, labels: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"labels": labels}, f, indent=2)


def print_confusion(y_true, y_pred, labels: list[str], title: str = "Confusion Matrix") -> None:
    cm = confusion_matrix(y_true, y_pred, labels=labels)
    print("\n" + title)
    print("labels:", labels)
    print(cm)


def load_static_dataset():
    """
    Loads static samples:
      dataset/raw/static/<LABEL>/*.npy

    Returns:
      X: (N,63) float32
      y: (N,) labels (strings)
      labels: sorted unique label names
    """
    if not STATIC_DIR.exists():
        raise FileNotFoundError(f"Static dataset folder not found: {STATIC_DIR}")

    labels = sorted([p.name for p in STATIC_DIR.iterdir() if p.is_dir()])
    if not labels:
        raise RuntimeError(f"No label folders found in: {STATIC_DIR}")

    X, y = [], []
    for label in labels:
        folder = STATIC_DIR / label
        for fp in sorted(folder.glob("*.npy")):
            vec = np.load(fp).astype(np.float32).reshape(-1)
            if vec.shape[0] != 63:
                # skip malformed sample
                continue
            X.append(vec)
            y.append(label)

    if not X:
        raise RuntimeError("No valid static samples loaded. Check dataset/raw/static/<LABEL>/*.npy")

    return np.stack(X, axis=0), np.array(y), labels


def load_motion_dataset(seq_len: int = 10):
    """
    Loads motion samples:
      dataset/raw/motion/<LABEL>/*.npz with key 'seq' shape (T,63)

    Baseline:
      - pad or truncate to fixed seq_len
      - flatten to (seq_len*63,)
      - train SVM

    Returns:
      X: (N, seq_len*63) float32
      y: (N,) labels (strings)
      labels: sorted unique label names
    """
    if not MOTION_DIR.exists():
        raise FileNotFoundError(f"Motion dataset folder not found: {MOTION_DIR}")

    labels = sorted([p.name for p in MOTION_DIR.iterdir() if p.is_dir()])
    if not labels:
        raise RuntimeError(f"No label folders found in: {MOTION_DIR}")

    X, y = [], []
    for label in labels:
        folder = MOTION_DIR / label
        for fp in sorted(folder.glob("*.npz")):
            data = np.load(fp)
            if "seq" not in data:
                continue
            seq = data["seq"].astype(np.float32)

            if seq.ndim != 2 or seq.shape[1] != 63:
                continue

            T = seq.shape[0]
            if T >= seq_len:
                fixed = seq[:seq_len]
            else:
                pad = np.zeros((seq_len - T, 63), dtype=np.float32)
                fixed = np.vstack([seq, pad])

            X.append(fixed.reshape(-1))  # (seq_len*63,)
            y.append(label)

    if not X:
        raise RuntimeError("No valid motion samples loaded. Check dataset/raw/motion/<LABEL>/*.npz")

    return np.stack(X, axis=0), np.array(y), labels


def train_svm_classifier(X, y, labels, test_size: float = 0.2, seed: int = 42):
    """
    Trains an RBF SVM classifier and prints metrics.
    """
    # If any class has too few examples, stratify can fail.
    #try stratify first; if it fails, fall back to non-stratified split.
    try:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=seed, stratify=y
        )
    except ValueError:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=seed
        )

    model = SVC(kernel="rbf", probability=True)
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred)

    print("\nAccuracy:", round(acc * 100, 2), "%")
    print("\nClassification report:\n", classification_report(y_test, y_pred, zero_division=0))
    print_confusion(y_test, y_pred, labels)

    return model


# ---------------- Main ----------------
def main():
    parser = argparse.ArgumentParser(description="Train ASL gesture models (static + motion).")
    parser.add_argument("--mode", choices=["static", "motion", "both"], default="static")
    parser.add_argument("--motion_seq_len", type=int, default=10, help="Fixed sequence length for motion model.")
    parser.add_argument("--test_size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if args.mode in ("static", "both"):
        print("\n=== TRAIN: STATIC (A–Z) ===")
        X, y, labels = load_static_dataset()
        print("Loaded static:", X.shape, "| classes:", len(labels))

        model = train_svm_classifier(X, y, labels, test_size=args.test_size, seed=args.seed)

        out_model = ARTIFACTS_DIR / "static_model.joblib"
        out_labels = ARTIFACTS_DIR / "static_labels.json"

        joblib.dump(model, out_model)
        save_labels(out_labels, labels)

        print("\nSaved:")
        print(" -", out_model)
        print(" -", out_labels)

    if args.mode in ("motion", "both"):
        print("\n=== TRAIN: MOTION (WORDS / J / Z) ===")
        X, y, labels = load_motion_dataset(seq_len=args.motion_seq_len)
        print("Loaded motion:", X.shape, "| classes:", len(labels))

        model = train_svm_classifier(X, y, labels, test_size=args.test_size, seed=args.seed)

        out_model = ARTIFACTS_DIR / "motion_model.joblib"
        out_labels = ARTIFACTS_DIR / "motion_labels.json"

        joblib.dump(model, out_model)
        save_labels(out_labels, labels)

        print("\nSaved:")
        print(" -", out_model)
        print(" -", out_labels)

    print("\nDone.")


if __name__ == "__main__":
    main()