import json
import joblib
import numpy as np
from pathlib import Path
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score

ROOT = Path(__file__).resolve().parent
DATASET_DIR = ROOT / "dataset" / "raw"
STATIC_DIR = DATASET_DIR / "static"
ARTIFACT_DIR = ROOT / "artifacts" / "gesture"
MODEL_PATH = ARTIFACT_DIR / "static_model.joblib"
LABELS_PATH = ARTIFACT_DIR / "static_labels.json"


def load_dataset():
    X = []
    y = []
    labels = sorted([p.name for p in STATIC_DIR.iterdir() if p.is_dir()])
    for label in labels:
        folder = STATIC_DIR / label
        for file in folder.glob("*.npy"):
            vec = np.load(file)
            if vec.shape[0] != 63:
                continue
            X.append(vec)
            y.append(label)
    return np.array(X), np.array(y), labels


def main():
    if not MODEL_PATH.exists():
        raise RuntimeError("Model not found. Train model first.")
    model = joblib.load(MODEL_PATH)
    X, y, labels = load_dataset()
    preds = model.predict(X)

    acc = accuracy_score(y, preds)
    print("\nAccuracy:", acc)

    print("\nClassification Report\n")
    print(classification_report(y, preds))

    print("\nConfusion Matrix\n")
    print(confusion_matrix(y, preds, labels=labels))

if __name__ == "__main__":
    main()