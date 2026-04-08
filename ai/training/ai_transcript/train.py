from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import (
    GridSearchCV,
    GroupKFold,
    GroupShuffleSplit,
    StratifiedKFold,
    train_test_split,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

from dataset_manifest import data_roots, load_manifest_index
from label_spec import load_label_spec


ROOT = Path(__file__).resolve().parent
DATASET_ROOTS = data_roots()
ARTIFACTS_DIR = ROOT / "artifacts" / "gesture"
REPORTS_DIR = ARTIFACTS_DIR / "reports"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

FEATURE_DIM = 63
MOTION_FEATURE_DIMS = {63, 126, 147}
LABEL_SPEC = load_label_spec()


def _json_dump(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def _allowed_labels(task: str) -> set[str]:
    if task == "static":
        return set(LABEL_SPEC.static_labels)
    return set(LABEL_SPEC.motion_labels)


def _task_dirs(task: str) -> list[Path]:
    dirs: list[Path] = []
    for root in DATASET_ROOTS:
        task_dir = root / task
        if task_dir.exists():
            dirs.append(task_dir)
    return dirs


def save_labels_meta(
    path: Path,
    *,
    task: str,
    labels: list[str],
    model_name: str,
    feature_dim: int = FEATURE_DIM,
    seq_len: int | None = None,
    model_backend: str = "sklearn",
) -> None:
    input_vector_dim = feature_dim if task == "static" else (int(seq_len or 0) + 4) * feature_dim
    input_representation = "flattened"
    if task == "motion" and model_backend == "torch_gru":
        input_vector_dim = feature_dim
        input_representation = "sequence"
    payload: dict[str, Any] = {
        "schema_version": "gesture_labels_v2",
        "labels_version": LABEL_SPEC.version,
        "task": task,
        "labels": labels,
        "feature_dim": feature_dim,
        "input_vector_dim": input_vector_dim,
        "model_name": model_name,
        "model_backend": model_backend,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "preprocessing": {
            "wrist_centered": True,
            "scale_normalized": True,
            "flattened": task == "motion" and input_representation == "flattened",
        },
    }
    if task == "motion":
        payload["seq_len"] = int(seq_len or 10)
        payload["input_representation"] = input_representation
        payload["sequence_input_shape"] = [int(seq_len or 10), feature_dim]
    _json_dump(path, payload)


def _vector_hash(vec: np.ndarray) -> str:
    q = np.round(vec.astype(np.float32), 4)
    return hashlib.sha1(q.tobytes()).hexdigest()


def _safe_class_counts(y: list[str] | np.ndarray) -> dict[str, int]:
    return {k: int(v) for k, v in sorted(Counter(list(y)).items(), key=lambda t: t[0])}


def _load_manifest_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(f"Manifest file not found: {path}")
    rows: list[dict[str, Any]] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict):
                rows.append(row)
    return rows


def _manifest_task_rows(rows: list[dict[str, Any]], task: str) -> list[dict[str, Any]]:
    return [r for r in rows if str(r.get("task", "")).lower() == task]


def _audit_task_from_manifest(
    *,
    task: str,
    rows: list[dict[str, Any]],
    min_samples_per_class: int,
) -> dict[str, Any]:
    filtered = _manifest_task_rows(rows, task)
    counts = Counter(str(r.get("label", "")).strip().upper() for r in filtered if str(r.get("label", "")).strip())
    low_count_labels = [k for k, v in sorted(counts.items()) if int(v) < min_samples_per_class]
    values = list(counts.values())
    balance_ratio = (min(values) / max(values)) if values and max(values) > 0 else 0.0
    return {
        "task": task,
        "labels_version": LABEL_SPEC.version,
        "source": "manifest",
        "total_labels": len(counts),
        "total_files_seen": len(filtered),
        "valid_samples": int(sum(counts.values())),
        "class_counts": {k: int(v) for k, v in sorted(counts.items())},
        "low_count_labels": low_count_labels,
        "min_samples_per_class_target": min_samples_per_class,
        "class_balance_ratio": round(float(balance_ratio), 4),
    }


def audit_static_dataset(min_samples_per_class: int = 10) -> dict[str, Any]:
    static_dirs = _task_dirs("static")
    if not static_dirs:
        raise FileNotFoundError("Static dataset folders not found under dataset/raw_custom, raw_converted, or raw.")
    labels = sorted(
        {
            p.name
            for static_dir in static_dirs
            for p in static_dir.iterdir()
            if p.is_dir()
        }
    )
    if not labels:
        raise RuntimeError("No label folders found in static dataset roots.")

    allowed = _allowed_labels("static")
    counts: dict[str, int] = {}
    malformed = 0
    unknown_labels = 0
    dup_hashes: Counter[str] = Counter()
    total_files = 0

    for label in labels:
        count = 0
        for static_dir in static_dirs:
            folder = static_dir / label
            if not folder.exists():
                continue
            if label not in allowed:
                unknown_labels += len(list(folder.glob("*.npy")))
                continue
            for fp in sorted(folder.glob("*.npy")):
                total_files += 1
                try:
                    vec = np.load(fp).astype(np.float32).reshape(-1)
                except Exception:
                    malformed += 1
                    continue
                if vec.shape[0] != FEATURE_DIM:
                    malformed += 1
                    continue
                count += 1
                dup_hashes[_vector_hash(vec)] += 1
        counts[label] = count

    duplicate_samples = int(sum(v - 1 for v in dup_hashes.values() if v > 1))
    low_count_labels = [k for k, v in counts.items() if v < min_samples_per_class]
    balance_ratio = (min(counts.values()) / max(counts.values())) if counts and max(counts.values()) > 0 else 0.0
    return {
        "task": "static",
        "labels_version": LABEL_SPEC.version,
        "paths": [str(p) for p in static_dirs],
        "total_labels": len(counts),
        "total_files_seen": total_files,
        "valid_samples": int(sum(counts.values())),
        "malformed_samples": malformed,
        "unknown_label_samples": unknown_labels,
        "duplicate_samples_estimate": duplicate_samples,
        "class_counts": counts,
        "low_count_labels": low_count_labels,
        "min_samples_per_class_target": min_samples_per_class,
        "class_balance_ratio": round(float(balance_ratio), 4),
    }


def audit_motion_dataset(seq_len: int, min_samples_per_class: int = 10) -> dict[str, Any]:
    motion_dirs = _task_dirs("motion")
    if not motion_dirs:
        raise FileNotFoundError("Motion dataset folders not found under dataset/raw_custom, raw_converted, or raw.")
    labels = sorted(
        {
            p.name
            for motion_dir in motion_dirs
            for p in motion_dir.iterdir()
            if p.is_dir()
        }
    )
    if not labels:
        raise RuntimeError("No label folders found in motion dataset roots.")

    allowed = _allowed_labels("motion")
    counts: dict[str, int] = {}
    malformed = 0
    unknown_labels = 0
    too_short = 0
    near_static = 0
    total_files = 0
    dup_hashes: Counter[str] = Counter()

    for label in labels:
        count = 0
        for motion_dir in motion_dirs:
            folder = motion_dir / label
            if not folder.exists():
                continue
            if label not in allowed:
                unknown_labels += len(list(folder.glob("*.npz")))
                continue
            for fp in sorted(folder.glob("*.npz")):
                total_files += 1
                try:
                    data = np.load(fp)
                    seq = data["seq"].astype(np.float32)
                except Exception:
                    malformed += 1
                    continue
                if seq.ndim != 2 or seq.shape[1] not in MOTION_FEATURE_DIMS:
                    malformed += 1
                    continue
                if seq.shape[0] < max(4, seq_len // 2):
                    too_short += 1
                if seq.shape[0] > 1:
                    motion_energy = float(np.mean(np.linalg.norm(np.diff(seq, axis=0), axis=1)))
                    if motion_energy < 0.03:
                        near_static += 1
                count += 1
                dup_hashes[_vector_hash(seq.reshape(-1))] += 1
        counts[label] = count

    duplicate_samples = int(sum(v - 1 for v in dup_hashes.values() if v > 1))
    low_count_labels = [k for k, v in counts.items() if v < min_samples_per_class]
    balance_ratio = (min(counts.values()) / max(counts.values())) if counts and max(counts.values()) > 0 else 0.0
    return {
        "task": "motion",
        "labels_version": LABEL_SPEC.version,
        "paths": [str(p) for p in motion_dirs],
        "total_labels": len(counts),
        "total_files_seen": total_files,
        "valid_samples": int(sum(counts.values())),
        "malformed_samples": malformed,
        "unknown_label_samples": unknown_labels,
        "too_short_samples": too_short,
        "near_static_samples": near_static,
        "duplicate_samples_estimate": duplicate_samples,
        "class_counts": counts,
        "low_count_labels": low_count_labels,
        "min_samples_per_class_target": min_samples_per_class,
        "class_balance_ratio": round(float(balance_ratio), 4),
    }


def _group_for_sample(path: Path, manifest_idx: dict[str, dict[str, Any]]) -> str:
    rel = str(path.relative_to(ROOT)).replace("\\", "/")
    row = manifest_idx.get(rel, {})
    return str(row.get("signer_id", "unknown")).strip() or "unknown"


def load_static_dataset(
    *,
    manifest_index: dict[str, dict[str, Any]] | None = None,
    manifest_rows: list[dict[str, Any]] | None = None,
) -> tuple[np.ndarray, np.ndarray, list[str], np.ndarray]:
    manifest_idx = manifest_index or {}
    if manifest_rows:
        X: list[np.ndarray] = []
        y: list[str] = []
        groups: list[str] = []
        for row in _manifest_task_rows(manifest_rows, "static"):
            label = str(row.get("label", "")).strip().upper()
            rel = str(row.get("sample_path", "")).replace("\\", "/").strip()
            if not label or not rel:
                continue
            fp = ROOT / rel
            if not fp.exists():
                continue
            try:
                vec = np.load(fp).astype(np.float32).reshape(-1)
            except Exception:
                continue
            if vec.shape[0] != FEATURE_DIM:
                continue
            X.append(vec)
            y.append(label)
            groups.append(str(row.get("signer_id", "unknown")).strip() or "unknown")
        if not X:
            raise RuntimeError("No valid static samples loaded from manifest.")
        labels = sorted(set(y))
        return np.stack(X, axis=0), np.array(y), labels, np.array(groups)

    static_dirs = _task_dirs("static")
    labels = sorted(
        {
            p.name
            for static_dir in static_dirs
            for p in static_dir.iterdir()
            if p.is_dir() and p.name in _allowed_labels("static")
        }
    )
    X: list[np.ndarray] = []
    y: list[str] = []
    groups: list[str] = []
    for label in labels:
        for static_dir in static_dirs:
            folder = static_dir / label
            if not folder.exists():
                continue
            for fp in sorted(folder.glob("*.npy")):
                vec = np.load(fp).astype(np.float32).reshape(-1)
                if vec.shape[0] != FEATURE_DIM:
                    continue
                X.append(vec)
                y.append(label)
                groups.append(_group_for_sample(fp, manifest_idx))
    if not X:
        raise RuntimeError(
            "No valid static samples loaded. Check dataset/raw_custom/static, "
            "dataset/raw_converted/static, or dataset/raw."
        )
    return np.stack(X, axis=0), np.array(y), labels, np.array(groups)


def _candidate_search_spaces(seed: int) -> list[tuple[str, Pipeline, dict[str, list[Any]]]]:
    return [
        (
            "svm_rbf",
            Pipeline(
                [
                    ("scaler", StandardScaler()),
                    ("model", SVC(kernel="rbf", probability=True, class_weight="balanced")),
                ]
            ),
            {"model__C": [1.0, 5.0, 10.0], "model__gamma": ["scale", 0.03, 0.01]},
        ),
        (
            "svm_linear",
            Pipeline(
                [
                    ("scaler", StandardScaler()),
                    ("model", SVC(kernel="linear", probability=True, class_weight="balanced")),
                ]
            ),
            {"model__C": [0.5, 1.0, 3.0, 10.0]},
        ),
        (
            "rf",
            Pipeline(
                [
                    ("scaler", "passthrough"),
                    (
                        "model",
                        RandomForestClassifier(
                            n_estimators=300,
                            random_state=seed,
                            class_weight="balanced_subsample",
                            n_jobs=-1,
                        ),
                    ),
                ]
            ),
            {"model__max_depth": [None, 10, 20], "model__min_samples_leaf": [1, 2, 4]},
        ),
    ]


def _split_dataset(
    X: np.ndarray,
    y: np.ndarray,
    groups: np.ndarray | None,
    *,
    test_size: float,
    seed: int,
    split_mode: str,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray | None, str, list[str]]:
    if groups is None or split_mode == "stratified" or len(set(groups.tolist())) < 2:
        try:
            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=test_size, random_state=seed, stratify=y
            )
        except ValueError:
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=test_size, random_state=seed)
        return X_train, X_test, y_train, y_test, None, "stratified_holdout", []
    gss = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=seed)
    train_idx, test_idx = next(gss.split(X, y, groups=groups))
    held_out = sorted({str(v) for v in groups[test_idx].tolist()})
    return (
        X[train_idx],
        X[test_idx],
        y[train_idx],
        y[test_idx],
        groups[train_idx],
        "group_holdout",
        held_out,
    )


def _best_cv_folds(y_train: np.ndarray, requested_folds: int) -> int:
    class_counts = Counter(y_train.tolist())
    min_count = min(class_counts.values())
    if min_count < 2:
        raise RuntimeError("At least 2 samples per class are required in the training split for stratified CV.")
    return min(requested_folds, min_count)


def run_model_selection(
    X: np.ndarray,
    y: np.ndarray,
    labels: list[str],
    *,
    seed: int,
    test_size: float,
    cv_folds: int,
    scoring: str = "f1_macro",
    groups: np.ndarray | None = None,
    split_mode: str = "auto",
) -> dict[str, Any]:
    if len(np.unique(y)) < 2:
        raise RuntimeError("Need at least 2 classes to train classifier.")
    effective_split_mode = "group" if split_mode == "auto" else split_mode
    (
        X_train,
        X_test,
        y_train,
        y_test,
        train_groups,
        split_name,
        held_out_groups,
    ) = _split_dataset(
        X,
        y,
        groups,
        test_size=test_size,
        seed=seed,
        split_mode=effective_split_mode,
    )

    chosen_name = ""
    chosen_estimator: Pipeline | None = None
    chosen_cv_score = float("-inf")
    chosen_params: dict[str, Any] = {}
    search_runs: list[dict[str, Any]] = []

    fit_kwargs: dict[str, Any] = {}
    if train_groups is not None and len(set(train_groups.tolist())) >= 2:
        max_cv = min(cv_folds, len(set(train_groups.tolist())))
        cv = GroupKFold(n_splits=max_cv)
        fit_kwargs["groups"] = train_groups
        cv_name = "group_kfold"
    else:
        max_cv = _best_cv_folds(y_train, cv_folds)
        cv = StratifiedKFold(n_splits=max_cv, shuffle=True, random_state=seed)
        cv_name = "stratified_kfold"

    for name, estimator, param_grid in _candidate_search_spaces(seed):
        search = GridSearchCV(
            estimator=estimator,
            param_grid=param_grid,
            scoring=scoring,
            cv=cv,
            n_jobs=-1,
            refit=True,
            error_score="raise",
        )
        search.fit(X_train, y_train, **fit_kwargs)
        score = float(search.best_score_)
        search_runs.append(
            {
                "model_name": name,
                "best_score": score,
                "best_params": search.best_params_,
            }
        )
        if score > chosen_cv_score:
            chosen_name = name
            chosen_cv_score = score
            chosen_estimator = search.best_estimator_
            chosen_params = search.best_params_

    if chosen_estimator is None:
        raise RuntimeError("Model selection failed; no estimator could be trained.")

    y_pred = chosen_estimator.predict(X_test)
    acc = float(accuracy_score(y_test, y_pred))
    macro_f1 = float(f1_score(y_test, y_pred, average="macro", zero_division=0))
    weighted_f1 = float(f1_score(y_test, y_pred, average="weighted", zero_division=0))
    cls_report = classification_report(y_test, y_pred, output_dict=True, zero_division=0)
    conf = confusion_matrix(y_test, y_pred, labels=labels).tolist()

    return {
        "model": chosen_estimator,
        "model_name": chosen_name,
        "search": {
            "cv_name": cv_name,
            "cv_folds": max_cv,
            "scoring": scoring,
            "chosen_model_name": chosen_name,
            "chosen_params": chosen_params,
            "chosen_cv_score": chosen_cv_score,
            "candidates": search_runs,
        },
        "metrics": {
            "accuracy": acc,
            "macro_f1": macro_f1,
            "weighted_f1": weighted_f1,
            "classification_report": cls_report,
            "confusion_matrix": {"labels": labels, "matrix": conf},
            "test_class_counts": _safe_class_counts(y_test),
        },
        "split": {
            "split_mode": split_name,
            "held_out_groups": held_out_groups,
            "train_size": int(len(X_train)),
            "test_size": int(len(X_test)),
            "train_class_counts": _safe_class_counts(y_train),
        },
    }


def _print_metrics(title: str, result: dict[str, Any]) -> None:
    m = result["metrics"]
    print(f"\n{title}")
    print(f"Model: {result['model_name']}")
    print(f"Accuracy: {m['accuracy'] * 100:.2f}%")
    print(f"Macro F1: {m['macro_f1']:.4f}")
    print(f"Weighted F1: {m['weighted_f1']:.4f}")
    print("\nConfusion labels:", m["confusion_matrix"]["labels"])
    print(np.array(m["confusion_matrix"]["matrix"]))


def _max_offdiag_confusion(confusion: list[list[int]]) -> float:
    arr = np.array(confusion, dtype=np.float32)
    if arr.size == 0:
        return 0.0
    row_sums = arr.sum(axis=1)
    max_rate = 0.0
    for i in range(arr.shape[0]):
        if row_sums[i] <= 0:
            continue
        offdiag = row_sums[i] - arr[i, i]
        max_rate = max(max_rate, float(offdiag / row_sums[i]))
    return max_rate


def _quality_gate_status(result: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    m = result["metrics"]
    conf = m["confusion_matrix"]["matrix"]
    report = m["classification_report"]
    labels = [k for k in report.keys() if k not in ("accuracy", "macro avg", "weighted avg")]
    min_support_seen = min((int(report[k].get("support", 0)) for k in labels), default=0)
    max_confusion_rate = _max_offdiag_confusion(conf)
    checks = {
        "macro_f1": float(m["macro_f1"]) >= float(args.min_macro_f1),
        "min_support": min_support_seen >= int(args.min_test_support_per_class),
        "max_confusion_rate": max_confusion_rate <= float(args.max_confusion_rate),
    }
    return {
        "min_macro_f1": float(args.min_macro_f1),
        "min_test_support_per_class": int(args.min_test_support_per_class),
        "max_confusion_rate_allowed": float(args.max_confusion_rate),
        "observed": {
            "macro_f1": float(m["macro_f1"]),
            "min_test_support_per_class": int(min_support_seen),
            "max_confusion_rate": float(max_confusion_rate),
        },
        "checks": checks,
        "passed": bool(all(checks.values())),
    }


def _train_one(
    *,
    task: str,
    X: np.ndarray,
    y: np.ndarray,
    labels: list[str],
    groups: np.ndarray,
    label_path: Path,
    model_path: Path,
    audit_report: dict[str, Any],
    args: argparse.Namespace,
) -> dict[str, Any]:
    result = run_model_selection(
        X,
        y,
        labels,
        seed=args.seed,
        test_size=args.test_size,
        cv_folds=args.cv_folds,
        scoring=args.scoring,
        groups=groups if len(groups) == len(y) else None,
        split_mode=args.split_mode,
    )
    _print_metrics(f"=== TRAIN: {task.upper()} ===", result)
    gate = _quality_gate_status(result, args)
    report_payload = {
        "task": task,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "labels_version": LABEL_SPEC.version,
        "dataset_audit": audit_report,
        "dataset_shape": [int(X.shape[0]), int(X.shape[1])],
        "labels": labels,
        "args": {
            "seed": args.seed,
            "test_size": args.test_size,
            "cv_folds": args.cv_folds,
            "scoring": args.scoring,
            "motion_seq_len": args.motion_seq_len,
            "split_mode": args.split_mode,
        },
        "result": {
            "model_name": result["model_name"],
            "search": result["search"],
            "metrics": result["metrics"],
            "split": result["split"],
        },
        "quality_gate": gate,
        "artifacts": {
            "model_path": str(model_path),
            "labels_path": str(label_path),
        },
    }
    _json_dump(REPORTS_DIR / f"{task}_train_report.json", report_payload)
    if not gate["passed"] and not args.allow_failed_gate:
        raise RuntimeError(f"{task} quality gate failed. See report: {REPORTS_DIR / f'{task}_train_report.json'}")

    joblib.dump(result["model"], model_path)
    save_labels_meta(
        label_path,
        task=task,
        labels=labels,
        model_name=result["model_name"],
        feature_dim=FEATURE_DIM,
        seq_len=(args.motion_seq_len if task == "motion" else None),
        model_backend="sklearn",
    )
    print("\nSaved:")
    print(" -", model_path)
    print(" -", label_path)
    print(" -", REPORTS_DIR / f"{task}_train_report.json")
    print("Quality gate:", "PASS" if gate["passed"] else "FAIL")
    return gate


def main() -> None:
    parser = argparse.ArgumentParser(description="Train ASL gesture models with audit + model selection.")
    parser.add_argument("--mode", choices=["static", "motion", "both"], default="static")
    parser.add_argument("--motion_seq_len", type=int, default=10, help="Fixed sequence length for motion model.")
    parser.add_argument("--test_size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--cv_folds", type=int, default=5)
    parser.add_argument("--scoring", type=str, default="f1_macro")
    parser.add_argument("--min_samples_per_class", type=int, default=10)
    parser.add_argument("--motion_epochs", type=int, default=30)
    parser.add_argument("--motion_batch_size", type=int, default=64)
    parser.add_argument("--motion_patience", type=int, default=5)
    parser.add_argument("--min_macro_f1", type=float, default=0.70)
    parser.add_argument("--min_test_support_per_class", type=int, default=1)
    parser.add_argument("--max_confusion_rate", type=float, default=0.45)
    parser.add_argument("--split_mode", choices=["auto", "group", "stratified"], default="auto")
    parser.add_argument("--manifest_path", type=str, default="")
    parser.add_argument("--allow_failed_gate", action="store_true")
    args = parser.parse_args()

    manifest_path = Path(args.manifest_path).resolve() if args.manifest_path else None
    manifest_index = load_manifest_index(manifest_path) if manifest_path else load_manifest_index()
    manifest_rows = _load_manifest_rows(manifest_path) if manifest_path else None

    build_manifest: dict[str, Any] = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "mode": args.mode,
        "labels_version": LABEL_SPEC.version,
        "args": vars(args),
    }

    if args.mode in ("static", "both"):
        static_audit = (
            _audit_task_from_manifest(task="static", rows=manifest_rows, min_samples_per_class=args.min_samples_per_class)
            if manifest_rows
            else audit_static_dataset(min_samples_per_class=args.min_samples_per_class)
        )
        _json_dump(REPORTS_DIR / "static_dataset_audit.json", static_audit)
        X, y, labels, groups = load_static_dataset(manifest_index=manifest_index, manifest_rows=manifest_rows)
        static_gate = _train_one(
            task="static",
            X=X,
            y=y,
            labels=labels,
            groups=groups,
            label_path=ARTIFACTS_DIR / "static_labels.json",
            model_path=ARTIFACTS_DIR / "static_model.joblib",
            audit_report=static_audit,
            args=args,
        )
        build_manifest["static"] = {
            "dataset_audit_path": str(REPORTS_DIR / "static_dataset_audit.json"),
            "train_report_path": str(REPORTS_DIR / "static_train_report.json"),
            "quality_gate_passed": bool(static_gate["passed"]),
        }

    if args.mode in ("motion", "both"):
        from motion_gru import (
            load_motion_sequence_dataset,
            run_motion_gru_experiment,
            save_motion_gru_checkpoint,
        )

        motion_audit = (
            _audit_task_from_manifest(task="motion", rows=manifest_rows, min_samples_per_class=args.min_samples_per_class)
            if manifest_rows
            else audit_motion_dataset(
                seq_len=args.motion_seq_len,
                min_samples_per_class=args.min_samples_per_class,
            )
        )
        _json_dump(REPORTS_DIR / "motion_dataset_audit.json", motion_audit)
        X, y, labels, groups, lengths = load_motion_sequence_dataset(
            seq_len=args.motion_seq_len,
            manifest_index=manifest_index,
            manifest_rows=manifest_rows,
        )
        result = run_motion_gru_experiment(
            X,
            y,
            labels,
            lengths=lengths,
            seed=args.seed,
            test_size=args.test_size,
            groups=groups if len(groups) == len(y) else None,
            split_mode=args.split_mode,
            epochs=args.motion_epochs,
            batch_size=args.motion_batch_size,
            patience=args.motion_patience,
        )
        _print_metrics("=== TRAIN: MOTION ===", result)
        motion_gate = _quality_gate_status(result, args)
        motion_model_path = ARTIFACTS_DIR / "motion_model.pt"
        motion_labels_path = ARTIFACTS_DIR / "motion_labels.json"
        report_payload = {
            "task": "motion",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "labels_version": LABEL_SPEC.version,
            "dataset_audit": motion_audit,
            "dataset_shape": [int(X.shape[0]), int(X.shape[1]), int(X.shape[2])],
            "labels": labels,
            "args": {
                "seed": args.seed,
                "test_size": args.test_size,
                "cv_folds": args.cv_folds,
                "scoring": args.scoring,
                "motion_seq_len": args.motion_seq_len,
                "motion_epochs": args.motion_epochs,
                "motion_batch_size": args.motion_batch_size,
                "motion_patience": args.motion_patience,
                "split_mode": args.split_mode,
            },
            "result": {
                "model_name": result["model_name"],
                "model_backend": result.get("model_backend", "torch_gru"),
                "search": result["search"],
                "metrics": result["metrics"],
                "split": result["split"],
            },
            "quality_gate": motion_gate,
            "artifacts": {
                "model_path": str(motion_model_path),
                "labels_path": str(motion_labels_path),
            },
        }
        _json_dump(REPORTS_DIR / "motion_train_report.json", report_payload)
        if not motion_gate["passed"] and not args.allow_failed_gate:
            raise RuntimeError(
                f"motion quality gate failed. See report: {REPORTS_DIR / 'motion_train_report.json'}"
            )
        save_motion_gru_checkpoint(motion_model_path, result["checkpoint"])
        save_labels_meta(
            motion_labels_path,
            task="motion",
            labels=labels,
            model_name=result["model_name"],
            feature_dim=int(result.get("feature_dim", FEATURE_DIM)),
            seq_len=args.motion_seq_len,
            model_backend="torch_gru",
        )
        print("\nSaved:")
        print(" -", motion_model_path)
        print(" -", motion_labels_path)
        print(" -", REPORTS_DIR / "motion_train_report.json")
        print("Quality gate:", "PASS" if motion_gate["passed"] else "FAIL")
        build_manifest["motion"] = {
            "dataset_audit_path": str(REPORTS_DIR / "motion_dataset_audit.json"),
            "train_report_path": str(REPORTS_DIR / "motion_train_report.json"),
            "quality_gate_passed": bool(motion_gate["passed"]),
        }

    _json_dump(ARTIFACTS_DIR / "build_manifest.json", build_manifest)
    print("\nSaved manifest:", ARTIFACTS_DIR / "build_manifest.json")
    print("Done.")


if __name__ == "__main__":
    main()