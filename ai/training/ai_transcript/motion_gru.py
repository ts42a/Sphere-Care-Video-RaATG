from __future__ import annotations

import copy
import random
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import GroupKFold, GroupShuffleSplit, StratifiedKFold, train_test_split
from torch import nn
from torch.nn.utils.rnn import pack_padded_sequence
from torch.utils.data import DataLoader, TensorDataset

from dataset_manifest import data_roots
from label_spec import load_label_spec


ROOT = Path(__file__).resolve().parent
LEGACY_MOTION_FEATURE_DIM = 63
MOTION_FEATURE_DIM = 126
POSE_FEATURE_DIM = 21
MOTION_FEATURE_DIM_WITH_POSE = MOTION_FEATURE_DIM + POSE_FEATURE_DIM
LABEL_SPEC = load_label_spec()
MIN_VALIDATION_SAMPLES = 8


def _allowed_motion_labels() -> set[str]:
    return set(LABEL_SPEC.motion_labels)


def _task_dirs(task: str) -> list[Path]:
    dirs: list[Path] = []
    for root in data_roots():
        task_dir = root / task
        if task_dir.exists():
            dirs.append(task_dir)
    return dirs


def _group_for_sample(path: Path, manifest_idx: dict[str, dict[str, Any]]) -> str:
    rel = str(path.relative_to(ROOT)).replace("\\", "/")
    row = manifest_idx.get(rel, {})
    return str(row.get("signer_id", "unknown")).strip() or "unknown"


def _upgrade_motion_seq(seq: np.ndarray) -> np.ndarray:
    if seq.ndim != 2:
        raise ValueError(f"Expected 2D motion tensor, got shape {seq.shape}")
    if seq.shape[1] == MOTION_FEATURE_DIM_WITH_POSE:
        return seq.astype(np.float32)
    if seq.shape[1] == MOTION_FEATURE_DIM:
        zeros = np.zeros((seq.shape[0], POSE_FEATURE_DIM), dtype=np.float32)
        return np.concatenate([seq.astype(np.float32), zeros], axis=1)
    if seq.shape[1] == LEGACY_MOTION_FEATURE_DIM:
        zeros = np.zeros((seq.shape[0], LEGACY_MOTION_FEATURE_DIM + POSE_FEATURE_DIM), dtype=np.float32)
        return np.concatenate([seq.astype(np.float32), zeros], axis=1)
    raise ValueError(f"Unsupported motion feature dim: {seq.shape[1]}")


def _fixed_seq_and_length(seq: np.ndarray, seq_len: int) -> tuple[np.ndarray, int]:
    upgraded = _upgrade_motion_seq(seq)
    valid_len = int(min(len(upgraded), seq_len))
    fixed = upgraded[:seq_len]
    if fixed.shape[0] < seq_len:
        pad = np.zeros((seq_len - fixed.shape[0], MOTION_FEATURE_DIM_WITH_POSE), dtype=np.float32)
        fixed = np.vstack([fixed, pad])
    return fixed.astype(np.float32), max(valid_len, 1)


def load_motion_sequence_dataset(
    seq_len: int = 10,
    *,
    manifest_index: dict[str, dict[str, Any]] | None = None,
    manifest_rows: list[dict[str, Any]] | None = None,
) -> tuple[np.ndarray, np.ndarray, list[str], np.ndarray, np.ndarray]:
    manifest_idx = manifest_index or {}
    X: list[np.ndarray] = []
    y: list[str] = []
    groups: list[str] = []
    lengths: list[int] = []

    if manifest_rows:
        for row in manifest_rows:
            if str(row.get("task", "")).lower() != "motion":
                continue
            label = str(row.get("label", "")).strip().upper()
            rel = str(row.get("sample_path", "")).replace("\\", "/").strip()
            if not label or not rel:
                continue
            fp = ROOT / rel
            if not fp.exists():
                continue
            try:
                data = np.load(fp)
                if "seq" not in data:
                    continue
                seq = data["seq"].astype(np.float32)
                fixed, valid_len = _fixed_seq_and_length(seq, seq_len)
            except Exception:
                continue
            X.append(fixed)
            y.append(label)
            groups.append(str(row.get("signer_id", "unknown")).strip() or "unknown")
            lengths.append(valid_len)
    else:
        motion_dirs = _task_dirs("motion")
        labels = sorted(
            {
                p.name
                for motion_dir in motion_dirs
                for p in motion_dir.iterdir()
                if p.is_dir() and p.name in _allowed_motion_labels()
            }
        )
        for label in labels:
            for motion_dir in motion_dirs:
                folder = motion_dir / label
                if not folder.exists():
                    continue
                for fp in sorted(folder.glob("*.npz")):
                    data = np.load(fp)
                    if "seq" not in data:
                        continue
                    seq = data["seq"].astype(np.float32)
                    try:
                        fixed, valid_len = _fixed_seq_and_length(seq, seq_len)
                    except ValueError:
                        continue
                    X.append(fixed)
                    y.append(label)
                    groups.append(_group_for_sample(fp, manifest_idx))
                    lengths.append(valid_len)

    if not X:
        raise RuntimeError(
            "No valid motion samples loaded. Check dataset/raw_custom/motion, "
            "dataset/raw_converted/motion, or dataset/raw."
        )
    labels = sorted(set(y))
    return np.stack(X, axis=0), np.array(y), labels, np.array(groups), np.array(lengths, dtype=np.int64)


class MotionGRUClassifier(nn.Module):
    def __init__(
        self,
        *,
        input_dim: int,
        hidden_dim: int,
        num_layers: int,
        dropout: float,
        num_classes: int,
    ) -> None:
        super().__init__()
        self.gru = nn.GRU(
            input_size=input_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(hidden_dim, num_classes)

    def forward(self, x: torch.Tensor, lengths: torch.Tensor | None = None) -> torch.Tensor:
        if lengths is not None:
            packed = pack_padded_sequence(
                x,
                lengths.detach().cpu(),
                batch_first=True,
                enforce_sorted=False,
            )
            _, hidden = self.gru(packed)
        else:
            _, hidden = self.gru(x)
        last = hidden[-1]
        last = self.dropout(last)
        return self.head(last)


@dataclass(frozen=True)
class CandidateConfig:
    name: str
    hidden_dim: int
    num_layers: int
    dropout: float
    learning_rate: float


DEFAULT_CANDIDATES = [
    CandidateConfig("gru_small", hidden_dim=96, num_layers=1, dropout=0.15, learning_rate=1e-3),
    CandidateConfig("gru_base", hidden_dim=128, num_layers=2, dropout=0.20, learning_rate=1e-3),
]


def _seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def _device_name() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


def _safe_class_counts(y: np.ndarray | list[str]) -> dict[str, int]:
    return {k: int(v) for k, v in sorted(Counter(list(y)).items(), key=lambda t: t[0])}


def _encode_labels(y: np.ndarray, labels: list[str]) -> np.ndarray:
    label_to_idx = {label: idx for idx, label in enumerate(labels)}
    return np.array([label_to_idx[str(v)] for v in y.tolist()], dtype=np.int64)


def _build_split(
    X: np.ndarray,
    y: np.ndarray,
    groups: np.ndarray | None,
    *,
    test_size: float,
    seed: int,
    split_mode: str,
) -> tuple[np.ndarray, np.ndarray, np.ndarray | None, str, list[str]]:
    idx = np.arange(len(X))
    if groups is None or split_mode == "stratified" or len(set(groups.tolist())) < 2:
        try:
            train_idx, test_idx = train_test_split(idx, test_size=test_size, random_state=seed, stratify=y)
        except ValueError:
            train_idx, test_idx = train_test_split(idx, test_size=test_size, random_state=seed)
        return train_idx, test_idx, None, "stratified_holdout", []
    splitter = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=seed)
    train_idx, test_idx = next(splitter.split(X, y, groups=groups))
    held_out = sorted({str(v) for v in groups[test_idx].tolist()})
    return train_idx, test_idx, groups[train_idx], "group_holdout", held_out


def _build_validation_split(
    y_train: np.ndarray,
    train_groups: np.ndarray | None,
    *,
    seed: int,
    val_size: float = 0.15,
) -> tuple[np.ndarray, np.ndarray]:
    idx = np.arange(len(y_train))
    if len(idx) < MIN_VALIDATION_SAMPLES:
        return idx, np.array([], dtype=np.int64)
    if train_groups is not None and len(set(train_groups.tolist())) >= 3:
        splitter = GroupShuffleSplit(n_splits=1, test_size=val_size, random_state=seed)
        inner_train_idx, val_idx = next(splitter.split(idx, y_train, groups=train_groups))
        return inner_train_idx, val_idx
    try:
        inner_train_idx, val_idx = train_test_split(idx, test_size=val_size, random_state=seed, stratify=y_train)
    except ValueError:
        inner_train_idx, val_idx = train_test_split(idx, test_size=val_size, random_state=seed)
    return inner_train_idx, val_idx


def _class_weights(y_train: np.ndarray, num_classes: int) -> torch.Tensor:
    counts = np.bincount(y_train, minlength=num_classes).astype(np.float32)
    counts[counts <= 0] = 1.0
    weights = counts.sum() / (num_classes * counts)
    return torch.tensor(weights, dtype=torch.float32)


def _make_loader(
    X: np.ndarray,
    y: np.ndarray,
    lengths: np.ndarray,
    *,
    batch_size: int,
    shuffle: bool,
) -> DataLoader:
    dataset = TensorDataset(
        torch.from_numpy(X).float(),
        torch.from_numpy(y).long(),
        torch.from_numpy(lengths).long(),
    )
    return DataLoader(dataset, batch_size=batch_size, shuffle=shuffle)


def _predict_indices(
    model: nn.Module,
    X: np.ndarray,
    lengths: np.ndarray,
    *,
    batch_size: int,
    device: torch.device,
) -> np.ndarray:
    loader = _make_loader(X, np.zeros(len(X), dtype=np.int64), lengths, batch_size=batch_size, shuffle=False)
    preds: list[np.ndarray] = []
    model.eval()
    with torch.no_grad():
        for xb, _, lb in loader:
            xb = xb.to(device)
            lb = lb.to(device)
            logits = model(xb, lb)
            pred = torch.argmax(logits, dim=1).cpu().numpy()
            preds.append(pred)
    return np.concatenate(preds, axis=0) if preds else np.array([], dtype=np.int64)


def predict_sequence_probs(bundle: dict[str, Any], seq: np.ndarray) -> np.ndarray:
    model: nn.Module = bundle["model"]
    device: torch.device = bundle["device"]
    arr = np.asarray(seq, dtype=np.float32)
    fixed, valid_len = _fixed_seq_and_length(arr, int(bundle["seq_len"]))
    x = torch.from_numpy(fixed[None, ...]).float().to(device)
    lengths = torch.tensor([valid_len], dtype=torch.long, device=device)
    model.eval()
    with torch.no_grad():
        logits = model(x, lengths)
        probs = torch.softmax(logits, dim=1)[0].cpu().numpy()
    return probs


def _init_model(
    candidate: CandidateConfig,
    num_classes: int,
    device: torch.device,
    *,
    input_dim: int,
) -> MotionGRUClassifier:
    return MotionGRUClassifier(
        input_dim=int(input_dim),
        hidden_dim=candidate.hidden_dim,
        num_layers=candidate.num_layers,
        dropout=candidate.dropout,
        num_classes=num_classes,
    ).to(device)


def _fit_model(
    X_train: np.ndarray,
    y_train: np.ndarray,
    lengths_train: np.ndarray,
    *,
    candidate: CandidateConfig,
    num_classes: int,
    epochs: int,
    batch_size: int,
    seed: int,
) -> dict[str, Any]:
    _seed_everything(seed)
    device = torch.device(_device_name())
    model = _init_model(candidate, num_classes, device, input_dim=int(X_train.shape[2]))
    criterion = nn.CrossEntropyLoss(weight=_class_weights(y_train, num_classes).to(device))
    optimizer = torch.optim.AdamW(model.parameters(), lr=candidate.learning_rate)
    train_loader = _make_loader(X_train, y_train, lengths_train, batch_size=batch_size, shuffle=True)
    history: list[dict[str, float]] = []

    for epoch in range(1, max(int(epochs), 1) + 1):
        model.train()
        train_loss = 0.0
        train_items = 0
        for xb, yb, lb in train_loader:
            xb = xb.to(device)
            yb = yb.to(device)
            lb = lb.to(device)
            optimizer.zero_grad()
            logits = model(xb, lb)
            loss = criterion(logits, yb)
            loss.backward()
            optimizer.step()
            batch_size_now = int(xb.shape[0])
            train_loss += float(loss.item()) * batch_size_now
            train_items += batch_size_now
        history.append({"epoch": float(epoch), "train_loss": float(train_loss / max(train_items, 1))})

    state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
    return {"model": model, "device": device, "state": state, "history": history}


def _score_candidate(
    X_train: np.ndarray,
    y_train: np.ndarray,
    lengths_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    lengths_val: np.ndarray,
    *,
    candidate: CandidateConfig,
    num_classes: int,
    epochs: int,
    batch_size: int,
    patience: int,
    seed: int,
) -> dict[str, Any]:
    _seed_everything(seed)
    device = torch.device(_device_name())
    model = _init_model(candidate, num_classes, device, input_dim=int(X_train.shape[2]))
    criterion = nn.CrossEntropyLoss(weight=_class_weights(y_train, num_classes).to(device))
    optimizer = torch.optim.AdamW(model.parameters(), lr=candidate.learning_rate)
    train_loader = _make_loader(X_train, y_train, lengths_train, batch_size=batch_size, shuffle=True)
    best_val_f1 = float("-inf")
    best_val_loss = float("inf")
    best_epoch = 1
    epochs_without_improve = 0
    history: list[dict[str, float]] = []
    has_validation = len(X_val) > 0

    for epoch in range(1, max(int(epochs), 1) + 1):
        model.train()
        train_loss = 0.0
        train_items = 0
        for xb, yb, lb in train_loader:
            xb = xb.to(device)
            yb = yb.to(device)
            lb = lb.to(device)
            optimizer.zero_grad()
            logits = model(xb, lb)
            loss = criterion(logits, yb)
            loss.backward()
            optimizer.step()
            batch_size_now = int(xb.shape[0])
            train_loss += float(loss.item()) * batch_size_now
            train_items += batch_size_now

        train_loss_mean = float(train_loss / max(train_items, 1))
        if has_validation:
            val_pred = _predict_indices(model, X_val, lengths_val, batch_size=batch_size, device=device)
            val_loader = _make_loader(X_val, y_val, lengths_val, batch_size=batch_size, shuffle=False)
            model.eval()
            val_loss = 0.0
            val_items = 0
            with torch.no_grad():
                for xb, yb, lb in val_loader:
                    xb = xb.to(device)
                    yb = yb.to(device)
                    lb = lb.to(device)
                    logits = model(xb, lb)
                    loss = criterion(logits, yb)
                    batch_size_now = int(xb.shape[0])
                    val_loss += float(loss.item()) * batch_size_now
                    val_items += batch_size_now
            val_loss_mean = float(val_loss / max(val_items, 1))
            val_macro_f1 = float(f1_score(y_val, val_pred, average="macro", zero_division=0))
            history.append(
                {
                    "epoch": float(epoch),
                    "train_loss": train_loss_mean,
                    "val_loss": val_loss_mean,
                    "val_macro_f1": val_macro_f1,
                }
            )
            improved = val_macro_f1 > best_val_f1 + 1e-5 or (
                abs(val_macro_f1 - best_val_f1) <= 1e-5 and val_loss_mean < best_val_loss
            )
            if improved:
                best_val_f1 = val_macro_f1
                best_val_loss = val_loss_mean
                best_epoch = epoch
                epochs_without_improve = 0
            else:
                epochs_without_improve += 1
                if epochs_without_improve >= patience:
                    break
        else:
            train_pred = _predict_indices(model, X_train, lengths_train, batch_size=batch_size, device=device)
            train_macro_f1 = float(f1_score(y_train, train_pred, average="macro", zero_division=0))
            history.append(
                {
                    "epoch": float(epoch),
                    "train_loss": train_loss_mean,
                    "train_macro_f1": train_macro_f1,
                }
            )
            best_epoch = epoch
            best_val_f1 = train_macro_f1

    return {
        "candidate": candidate,
        "best_epoch": int(best_epoch),
        "best_val_macro_f1": float(best_val_f1),
        "history": history,
        "used_validation": has_validation,
    }


def _evaluate_predictions(y_true_idx: np.ndarray, y_pred_idx: np.ndarray, labels: list[str]) -> dict[str, Any]:
    y_true = np.array([labels[int(v)] for v in y_true_idx.tolist()])
    y_pred = np.array([labels[int(v)] for v in y_pred_idx.tolist()])
    acc = float(accuracy_score(y_true, y_pred))
    macro_f1 = float(f1_score(y_true, y_pred, average="macro", zero_division=0))
    weighted_f1 = float(f1_score(y_true, y_pred, average="weighted", zero_division=0))
    report = classification_report(y_true, y_pred, output_dict=True, zero_division=0)
    conf = confusion_matrix(y_true, y_pred, labels=labels).tolist()
    return {
        "accuracy": acc,
        "macro_f1": macro_f1,
        "weighted_f1": weighted_f1,
        "classification_report": report,
        "confusion_matrix": {"labels": labels, "matrix": conf},
        "test_class_counts": _safe_class_counts(y_true),
    }


def run_motion_gru_experiment(
    X: np.ndarray,
    y: np.ndarray,
    labels: list[str],
    *,
    lengths: np.ndarray,
    seed: int,
    test_size: float,
    groups: np.ndarray | None,
    split_mode: str = "auto",
    epochs: int = 30,
    batch_size: int = 64,
    patience: int = 5,
    candidates: list[CandidateConfig] | None = None,
) -> dict[str, Any]:
    if len(np.unique(y)) < 2:
        raise RuntimeError("Need at least 2 classes to train classifier.")
    y_idx = _encode_labels(y, labels)
    effective_split_mode = "group" if split_mode == "auto" else split_mode
    train_idx, test_idx, train_groups, split_name, held_out_groups = _build_split(
        X,
        y,
        groups,
        test_size=test_size,
        seed=seed,
        split_mode=effective_split_mode,
    )
    X_train_all = X[train_idx]
    y_train_all = y_idx[train_idx]
    lengths_train_all = lengths[train_idx]
    X_test = X[test_idx]
    y_test = y_idx[test_idx]
    lengths_test = lengths[test_idx]

    inner_train_idx, val_idx = _build_validation_split(y_train_all, train_groups, seed=seed)
    X_inner_train = X_train_all[inner_train_idx]
    y_inner_train = y_train_all[inner_train_idx]
    lengths_inner_train = lengths_train_all[inner_train_idx]
    X_val = X_train_all[val_idx]
    y_val = y_train_all[val_idx]
    lengths_val = lengths_train_all[val_idx]

    candidate_configs = candidates or DEFAULT_CANDIDATES
    runs: list[dict[str, Any]] = []
    best_run: dict[str, Any] | None = None

    for idx, candidate in enumerate(candidate_configs):
        run = _score_candidate(
            X_inner_train,
            y_inner_train,
            lengths_inner_train,
            X_val,
            y_val,
            lengths_val,
            candidate=candidate,
            num_classes=len(labels),
            epochs=epochs,
            batch_size=batch_size,
            patience=patience,
            seed=seed + idx,
        )
        runs.append(
            {
                "model_name": candidate.name,
                "hidden_dim": candidate.hidden_dim,
                "num_layers": candidate.num_layers,
                "dropout": candidate.dropout,
                "learning_rate": candidate.learning_rate,
                "best_epoch": int(run["best_epoch"]),
                "best_val_macro_f1": float(run["best_val_macro_f1"]),
                "used_validation": bool(run["used_validation"]),
            }
        )
        if best_run is None or run["best_val_macro_f1"] > best_run["best_val_macro_f1"]:
            best_run = run

    if best_run is None:
        raise RuntimeError("GRU model selection failed.")

    candidate = best_run["candidate"]
    final_fit = _fit_model(
        X_train_all,
        y_train_all,
        lengths_train_all,
        candidate=candidate,
        num_classes=len(labels),
        epochs=max(int(best_run["best_epoch"]), 1),
        batch_size=batch_size,
        seed=seed + 1000,
    )
    pred_idx = _predict_indices(
        final_fit["model"],
        X_test,
        lengths_test,
        batch_size=batch_size,
        device=final_fit["device"],
    )
    metrics = _evaluate_predictions(y_test, pred_idx, labels)
    checkpoint = {
        "model_state_dict": copy.deepcopy(final_fit["state"]),
        "model_name": candidate.name,
        "model_backend": "torch_gru",
        "feature_dim": int(X.shape[2]),
        "seq_len": int(X.shape[1]),
        "num_classes": len(labels),
        "hidden_dim": candidate.hidden_dim,
        "num_layers": candidate.num_layers,
        "dropout": candidate.dropout,
        "labels": labels,
    }
    return {
        "model_name": candidate.name,
        "model_backend": "torch_gru",
        "feature_dim": int(X.shape[2]),
        "search": {
            "cv_name": "validation_holdout",
            "cv_folds": 1,
            "scoring": "f1_macro",
            "chosen_model_name": candidate.name,
            "chosen_params": {
                "hidden_dim": candidate.hidden_dim,
                "num_layers": candidate.num_layers,
                "dropout": candidate.dropout,
                "learning_rate": candidate.learning_rate,
                "selection_epochs": epochs,
                "final_refit_epochs": int(best_run["best_epoch"]),
                "batch_size": batch_size,
                "patience": patience,
            },
            "chosen_cv_score": float(best_run["best_val_macro_f1"]),
            "candidates": runs,
        },
        "metrics": metrics,
        "split": {
            "split_mode": split_name,
            "held_out_groups": held_out_groups,
            "train_size": int(len(train_idx)),
            "test_size": int(len(test_idx)),
            "train_class_counts": _safe_class_counts(y[train_idx]),
        },
        "checkpoint": checkpoint,
    }


def cross_validate_motion_gru(
    X: np.ndarray,
    y: np.ndarray,
    labels: list[str],
    *,
    lengths: np.ndarray,
    groups: np.ndarray | None,
    split_mode: str,
    cv_folds: int,
    seed: int,
    epochs: int = 30,
    batch_size: int = 64,
    patience: int = 5,
) -> dict[str, Any]:
    y_idx = _encode_labels(y, labels)
    if groups is not None and len(set(groups.tolist())) >= 2 and split_mode != "stratified":
        fold_count = min(cv_folds, len(set(groups.tolist())))
        splitter = GroupKFold(n_splits=fold_count)
        fold_iter = splitter.split(X, y_idx, groups=groups)
        cv_name = "group_kfold"
    else:
        class_counts = Counter(y.tolist())
        min_count = min(class_counts.values())
        if min_count < 2:
            raise RuntimeError("Need at least 2 samples per class for GRU cross-validation.")
        fold_count = min(cv_folds, min_count)
        splitter = StratifiedKFold(n_splits=fold_count, shuffle=True, random_state=seed)
        fold_iter = splitter.split(X, y_idx)
        cv_name = "stratified_kfold"

    scores: list[float] = []
    for fold_id, (train_idx, test_idx) in enumerate(fold_iter):
        fold_groups = groups[train_idx] if groups is not None else None
        inner_train_idx, val_idx = _build_validation_split(y_idx[train_idx], fold_groups, seed=seed + fold_id)
        best_run: dict[str, Any] | None = None
        for candidate_offset, candidate in enumerate(DEFAULT_CANDIDATES):
            run = _score_candidate(
                X[train_idx][inner_train_idx],
                y_idx[train_idx][inner_train_idx],
                lengths[train_idx][inner_train_idx],
                X[train_idx][val_idx],
                y_idx[train_idx][val_idx],
                lengths[train_idx][val_idx],
                candidate=candidate,
                num_classes=len(labels),
                epochs=epochs,
                batch_size=batch_size,
                patience=patience,
                seed=seed + fold_id * 17 + candidate_offset,
            )
            if best_run is None or run["best_val_macro_f1"] > best_run["best_val_macro_f1"]:
                best_run = run
        if best_run is None:
            raise RuntimeError("GRU cross-validation fold failed.")
        final_fit = _fit_model(
            X[train_idx],
            y_idx[train_idx],
            lengths[train_idx],
            candidate=best_run["candidate"],
            num_classes=len(labels),
            epochs=max(int(best_run["best_epoch"]), 1),
            batch_size=batch_size,
            seed=seed + 500 + fold_id,
        )
        pred_idx = _predict_indices(
            final_fit["model"],
            X[test_idx],
            lengths[test_idx],
            batch_size=batch_size,
            device=final_fit["device"],
        )
        fold_macro_f1 = float(f1_score(y_idx[test_idx], pred_idx, average="macro", zero_division=0))
        scores.append(fold_macro_f1)

    scores_arr = np.array(scores, dtype=np.float32)
    return {
        "cv_name": cv_name,
        "cv_folds": int(len(scores)),
        "scoring": "f1_macro",
        "scores": [float(v) for v in scores_arr.tolist()],
        "mean": float(scores_arr.mean()) if len(scores_arr) else 0.0,
        "std": float(scores_arr.std()) if len(scores_arr) else 0.0,
    }


def save_motion_gru_checkpoint(path: Path, checkpoint: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(checkpoint, path)


def load_motion_gru_checkpoint(path: Path) -> dict[str, Any]:
    device = torch.device(_device_name())
    checkpoint = torch.load(path, map_location=device, weights_only=False)
    model = MotionGRUClassifier(
        input_dim=int(checkpoint.get("feature_dim", MOTION_FEATURE_DIM)),
        hidden_dim=int(checkpoint["hidden_dim"]),
        num_layers=int(checkpoint["num_layers"]),
        dropout=float(checkpoint["dropout"]),
        num_classes=int(checkpoint["num_classes"]),
    ).to(device)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    checkpoint["model"] = model
    checkpoint["device"] = device
    return checkpoint
