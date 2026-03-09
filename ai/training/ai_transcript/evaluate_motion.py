import json
import joblib
import numpy as np
from pathlib import Path
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score

ROOT = Path(__file__).resolve().parent
DATASET_DIR = ROOT / "dataset" / "raw"
MOTION_DIR = DATASET_DIR / "motion"
ARTIFACT_DIR = ROOT / "artifacts" / "gesture"
MODEL_PATH = ARTIFACT_DIR / "motion_model.joblib"
LABELS_PATH = ARTIFACT_DIR / "motion_labels.json"

def load_motion_dataset(seq_len: int = 10):
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
            seq = data['seq'].astype(np.float32)
            if seq.shape[1] != 63:
                continue
            # pad or truncate to seq_len
            if seq.shape[0] < seq_len:
                # pad with zeros
                pad_len = seq_len - seq.shape[0]
                seq = np.pad(seq, ((0, pad_len), (0, 0)), mode='constant')
            elif seq.shape[0] > seq_len:
                seq = seq[:seq_len]
            # flatten
            vec = seq.reshape(-1)
            X.append(vec)
            y.append(label)
    if not X:
        raise RuntimeError("No valid motion samples loaded. Check dataset/raw/motion/<LABEL>/*.npz")
    return np.stack(X, axis=0), np.array(y), labels



def main():
    if not MODEL_PATH.exists():
        raise RuntimeError("Model not found. Train model first.")
    model = joblib.load(MODEL_PATH)
    X, y, labels = load_motion_dataset()
    preds = model.predict(X)
    
    acc = accuracy_score(y, preds)
    print("\nAccuracy:", acc)

    print("\nClassification Report\n")
    print(classification_report(y, preds))

    print("\nConfusion Matrix\n")
    print(confusion_matrix(y, preds, labels=labels))

if __name__ == "__main__":
    main()