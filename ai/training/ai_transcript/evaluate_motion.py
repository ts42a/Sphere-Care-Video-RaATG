import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from train import (
    LABEL_SPEC,
    REPORTS_DIR,
    _json_dump,
    _audit_task_from_manifest,
    _load_manifest_rows,
    audit_motion_dataset,
    load_manifest_index,
)
from motion_gru import cross_validate_motion_gru, load_motion_sequence_dataset, run_motion_gru_experiment


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate motion gesture model with hold-out + CV metrics.")
    parser.add_argument("--motion_seq_len", type=int, default=10)
    parser.add_argument("--test_size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--cv_folds", type=int, default=5)
    parser.add_argument("--min_samples_per_class", type=int, default=10)
    parser.add_argument("--motion_epochs", type=int, default=30)
    parser.add_argument("--motion_batch_size", type=int, default=64)
    parser.add_argument("--motion_patience", type=int, default=5)
    parser.add_argument("--min_macro_f1", type=float, default=0.70)
    parser.add_argument("--split_mode", choices=["auto", "group", "stratified"], default="auto")
    parser.add_argument("--manifest_path", type=str, default="")
    args = parser.parse_args()

    manifest_path = Path(args.manifest_path).resolve() if args.manifest_path else None
    manifest_index = load_manifest_index(manifest_path) if manifest_path else load_manifest_index()
    manifest_rows = _load_manifest_rows(manifest_path) if manifest_path else None
    audit = (
        _audit_task_from_manifest(task="motion", rows=manifest_rows, min_samples_per_class=args.min_samples_per_class)
        if manifest_rows
        else audit_motion_dataset(
            seq_len=args.motion_seq_len,
            min_samples_per_class=args.min_samples_per_class,
        )
    )
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
        groups=groups,
        split_mode=args.split_mode,
        epochs=args.motion_epochs,
        batch_size=args.motion_batch_size,
        patience=args.motion_patience,
    )
    cv_report = cross_validate_motion_gru(
        X,
        y,
        labels,
        lengths=lengths,
        groups=groups,
        split_mode=args.split_mode,
        cv_folds=args.cv_folds,
        seed=args.seed,
        epochs=args.motion_epochs,
        batch_size=args.motion_batch_size,
        patience=args.motion_patience,
    )

    macro_f1 = result["metrics"]["macro_f1"]
    report = {
        "task": "motion",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "labels_version": LABEL_SPEC.version,
        "dataset_audit": audit,
        "dataset_shape": [int(X.shape[0]), int(X.shape[1]), int(X.shape[2])],
        "labels": labels,
        "args": vars(args),
        "holdout": {
            "model_name": result["model_name"],
            "model_backend": result.get("model_backend", "torch_gru"),
            "search": result["search"],
            "split": result["split"],
            "metrics": result["metrics"],
        },
        "cross_validation": cv_report,
        "quality_gate": {
            "min_macro_f1": args.min_macro_f1,
            "passed": bool(macro_f1 >= args.min_macro_f1),
        },
    }
    out_path = REPORTS_DIR / "motion_evaluation_report.json"
    _json_dump(out_path, report)
    print(json.dumps(report["holdout"]["metrics"], indent=2))
    print("\nCV mean:", round(report["cross_validation"]["mean"], 4))
    print("Saved:", out_path)


if __name__ == "__main__":
    main()