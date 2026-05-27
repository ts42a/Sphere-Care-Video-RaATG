"""Save exactly 2 PNG summaries per model under artifacts/gesture/train_report/{task}/."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from train import TRAIN_REPORT_DIR


def _require_matplotlib():
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        return plt
    except ImportError as exc:
        raise RuntimeError("matplotlib is required for training images. Run: pip install matplotlib") from exc


def _task_image_dir(task: str) -> Path:
    out = TRAIN_REPORT_DIR / task
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*"):
        if old.is_file():
            old.unlink()
    return out


def _save_confusion_image(
    plt,
    out_path: Path,
    *,
    labels: list[str],
    matrix: list[list[int]],
    title: str,
) -> None:
    arr = np.array(matrix, dtype=np.float32)
    fig, ax = plt.subplots(figsize=(max(8, len(labels) * 0.35), max(6, len(labels) * 0.35)))
    im = ax.imshow(arr, cmap="Blues", aspect="auto")
    ax.set_xticks(range(len(labels)))
    ax.set_yticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=90, fontsize=7)
    ax.set_yticklabels(labels, fontsize=7)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("True")
    ax.set_title(title)
    for i in range(arr.shape[0]):
        for j in range(arr.shape[1]):
            val = int(arr[i, j])
            if val > 0:
                ax.text(j, i, str(val), ha="center", va="center", fontsize=6, color="black")
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)


def _save_heatmap_image(
    plt,
    out_path: Path,
    *,
    data: np.ndarray,
    row_labels: list[str],
    col_labels: list[str] | None,
    title: str,
    xlabel: str,
    ylabel: str,
) -> None:
    fig_w = max(8, (data.shape[1] if data.ndim == 2 else 10) * 0.2)
    fig_h = max(6, data.shape[0] * 0.3)
    fig, ax = plt.subplots(figsize=(fig_w, fig_h))
    im = ax.imshow(data, cmap="viridis", aspect="auto")
    ax.set_yticks(range(len(row_labels)))
    ax.set_yticklabels(row_labels, fontsize=7)
    if col_labels is not None:
        ax.set_xticks(range(len(col_labels)))
        ax.set_xticklabels(col_labels, rotation=90, fontsize=7)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)


def _save_class_counts_image(
    plt,
    out_path: Path,
    *,
    labels: list[str],
    y: np.ndarray,
    title: str,
) -> None:
    counts = [int(np.sum(y == lab)) for lab in labels]
    fig, ax = plt.subplots(figsize=(max(8, len(labels) * 0.35), 5))
    ax.bar(labels, counts, color="steelblue")
    ax.set_xlabel("Class")
    ax.set_ylabel("Samples")
    ax.set_title(title)
    plt.setp(ax.get_xticklabels(), rotation=90, fontsize=8)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)


def save_static_training_images(
    X: np.ndarray,
    y: np.ndarray,
    labels: list[str],
    metrics: dict[str, Any] | None = None,
) -> list[Path]:
    """Image 1: confusion matrix (or class counts). Image 2: mean feature vector per class."""
    plt = _require_matplotlib()
    out_dir = _task_image_dir("static")
    paths: list[Path] = []

    p1 = out_dir / "01_confusion_matrix.png"
    if metrics and metrics.get("confusion_matrix"):
        conf = metrics["confusion_matrix"]
        _save_confusion_image(
            plt,
            p1,
            labels=conf["labels"],
            matrix=conf["matrix"],
            title="Static — test confusion matrix",
        )
    else:
        p1 = out_dir / "01_class_counts.png"
        _save_class_counts_image(plt, p1, labels=labels, y=y, title="Static — samples per class")
    paths.append(p1)

  # Mean (63,) feature per class -> heatmap 25 x 63
    rows = []
    for lab in labels:
        mask = y == lab
        if not np.any(mask):
            rows.append(np.zeros(X.shape[1], dtype=np.float32))
        else:
            rows.append(X[mask].mean(axis=0))
    data = np.stack(rows, axis=0)
    feat_cols = [str(i) for i in range(data.shape[1])]
    p2 = out_dir / "02_mean_features_by_class.png"
    _save_heatmap_image(
        plt,
        p2,
        data=data,
        row_labels=labels,
        col_labels=feat_cols if data.shape[1] <= 80 else None,
        title="Static — mean hand features by class",
        xlabel="Feature index",
        ylabel="Class",
    )
    paths.append(p2)
    return paths


def save_motion_training_images(
    X: np.ndarray,
    y: np.ndarray,
    labels: list[str],
    lengths: np.ndarray,
    metrics: dict[str, Any] | None = None,
) -> list[Path]:
    """Image 1: confusion matrix (or class counts). Image 2: mean |motion| per class over time."""
    plt = _require_matplotlib()
    out_dir = _task_image_dir("motion")
    paths: list[Path] = []

    p1 = out_dir / "01_confusion_matrix.png"
    if metrics and metrics.get("confusion_matrix"):
        conf = metrics["confusion_matrix"]
        _save_confusion_image(
            plt,
            p1,
            labels=conf["labels"],
            matrix=conf["matrix"],
            title="Motion — test confusion matrix",
        )
    else:
        p1 = out_dir / "01_class_counts.png"
        _save_class_counts_image(plt, p1, labels=labels, y=y, title="Motion — samples per class")
    paths.append(p1)

    seq_len = X.shape[1]
    rows = []
    for lab in labels:
        mask = y == lab
        if not np.any(mask):
            rows.append(np.zeros(seq_len, dtype=np.float32))
            continue
        chunks = X[mask]
        lens = lengths[mask]
        acc = np.zeros(seq_len, dtype=np.float32)
        count = 0
        for seq, valid_len in zip(chunks, lens):
            n = max(1, min(int(valid_len), seq_len))
            acc[:n] += np.abs(seq[:n]).mean(axis=1)
            count += 1
        rows.append(acc / max(count, 1))
    data = np.stack(rows, axis=0)
    frame_cols = [f"t{i}" for i in range(seq_len)]
    p2 = out_dir / "02_mean_motion_by_class.png"
    _save_heatmap_image(
        plt,
        p2,
        data=data,
        row_labels=labels,
        col_labels=frame_cols,
        title="Motion — mean |features| by class over time",
        xlabel="Frame",
        ylabel="Class",
    )
    paths.append(p2)
    return paths
