import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from sklearn.model_selection import GroupKFold, StratifiedKFold, cross_val_score

from train import (
    LABEL_SPEC,
    REPORTS_DIR,
    _json_dump,
    _safe_class_counts,
    audit_static_dataset,
    load_static_dataset,
    load_manifest_index,
    run_model_selection,
)

ROOT = Path(__file__).resolve().parent


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate static gesture model with hold-out + CV metrics.")
    parser.add_argument("--test_size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--cv_folds", type=int, default=5)
    parser.add_argument("--scoring", type=str, default="f1_macro")
    parser.add_argument("--min_samples_per_class", type=int, default=10)
    parser.add_argument("--min_macro_f1", type=float, default=0.70)
    parser.add_argument("--split_mode", choices=["auto", "group", "stratified"], default="auto")
    parser.add_argument("--manifest_path", type=str, default="")
    args = parser.parse_args()

    audit = audit_static_dataset(min_samples_per_class=args.min_samples_per_class)
    manifest_path = Path(args.manifest_path).resolve() if args.manifest_path else None
    manifest_index = load_manifest_index(manifest_path) if manifest_path else load_manifest_index()
    X, y, labels, groups = load_static_dataset(manifest_index=manifest_index)
    result = run_model_selection(
        X,
        y,
        labels,
        seed=args.seed,
        test_size=args.test_size,
        cv_folds=args.cv_folds,
        scoring=args.scoring,
        groups=groups,
        split_mode=args.split_mode,
    )
    model = result["model"]
    unique_groups = sorted(set(groups.tolist()))
    if len(unique_groups) >= 2 and args.split_mode != "stratified":
        cv_folds = min(args.cv_folds, len(unique_groups))
        cv = GroupKFold(n_splits=cv_folds)
        cv_scores = cross_val_score(model, X, y, cv=cv, groups=groups, scoring=args.scoring, n_jobs=-1)
        cv_name = "group_kfold"
    else:
        min_class_count = min(_safe_class_counts(y).values())
        if min_class_count < 2:
            raise RuntimeError("Need at least 2 samples per class for cross-validation.")
        cv_folds = min(args.cv_folds, min_class_count)
        cv = StratifiedKFold(n_splits=cv_folds, shuffle=True, random_state=args.seed)
        cv_scores = cross_val_score(model, X, y, cv=cv, scoring=args.scoring, n_jobs=-1)
        cv_name = "stratified_kfold"

    macro_f1 = result["metrics"]["macro_f1"]
    report = {
        "task": "static",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "labels_version": LABEL_SPEC.version,
        "dataset_audit": audit,
        "dataset_shape": [int(X.shape[0]), int(X.shape[1])],
        "labels": labels,
        "args": vars(args),
        "holdout": {
            "model_name": result["model_name"],
            "search": result["search"],
            "split": result["split"],
            "metrics": result["metrics"],
        },
        "cross_validation": {
            "cv_name": cv_name,
            "cv_folds": cv_folds,
            "scoring": args.scoring,
            "scores": [float(v) for v in cv_scores],
            "mean": float(cv_scores.mean()),
            "std": float(cv_scores.std()),
        },
        "quality_gate": {
            "min_macro_f1": args.min_macro_f1,
            "passed": bool(macro_f1 >= args.min_macro_f1),
        },
    }
    out_path = REPORTS_DIR / "static_evaluation_report.json"
    _json_dump(out_path, report)
    print(json.dumps(report["holdout"]["metrics"], indent=2))
    print("\nCV mean:", round(report["cross_validation"]["mean"], 4))
    print("Saved:", out_path)


if __name__ == "__main__":
    main()