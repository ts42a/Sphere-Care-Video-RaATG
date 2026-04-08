import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def _run(cmd: list[str]) -> None:
    print("\n$", " ".join(cmd))
    subprocess.run(cmd, cwd=str(ROOT), check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="One-command workflow for transcript gesture model pipeline.")
    parser.add_argument("--mode", choices=["static", "motion", "both"], default="both")
    parser.add_argument("--motion-seq-len", type=int, default=10)
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--cv-folds", type=int, default=5)
    parser.add_argument("--split-mode", choices=["auto", "group", "stratified"], default="auto")
    parser.add_argument("--manifest-path", type=str, default="")
    parser.add_argument("--min-macro-f1", type=float, default=0.70)
    parser.add_argument("--min-test-support-per-class", type=int, default=1)
    parser.add_argument("--max-confusion-rate", type=float, default=0.45)
    parser.add_argument("--allow-failed-gate", action="store_true")
    parser.add_argument("--runtime-dir", type=str, default="")
    parser.add_argument("--strict-export", action="store_true")
    parser.add_argument("--build-signer-splits", action="store_true")
    parser.add_argument("--calibrate", action="store_true")
    parser.add_argument("--convert-asl-root", type=str, default="")
    parser.add_argument("--convert-asl-max-per-label", type=int, default=0)
    parser.add_argument("--convert-wlasl-meta", type=str, default="")
    parser.add_argument("--convert-wlasl-videos", type=str, default="")
    parser.add_argument("--convert-wlasl-max-per-label", type=int, default=0)
    parser.add_argument("--skip-eval", action="store_true")
    args = parser.parse_args()

    base = [sys.executable]
    if args.convert_asl_root:
        asl_cmd = base + [
            "convert_asl_alphabet.py",
            "--source-root",
            args.convert_asl_root,
        ]
        if args.convert_asl_max_per_label > 0:
            asl_cmd += ["--max-per-label", str(args.convert_asl_max_per_label)]
        _run(asl_cmd)

    if args.convert_wlasl_meta and args.convert_wlasl_videos:
        wlasl_cmd = base + [
            "convert_wlasl.py",
            "--metadata-json",
            args.convert_wlasl_meta,
            "--videos-root",
            args.convert_wlasl_videos,
            "--seq-len",
            str(args.motion_seq_len),
        ]
        if args.convert_wlasl_max_per_label > 0:
            wlasl_cmd += ["--max-sequences-per-label", str(args.convert_wlasl_max_per_label)]
        _run(wlasl_cmd)

    if args.build_signer_splits:
        split_cmd = base + ["build_splits.py"]
        if args.manifest_path:
            split_cmd += ["--manifest", args.manifest_path]
        _run(split_cmd)

    train_cmd = base + [
        "train.py",
        "--mode",
        args.mode,
        "--motion_seq_len",
        str(args.motion_seq_len),
        "--test_size",
        str(args.test_size),
        "--seed",
        str(args.seed),
        "--cv_folds",
        str(args.cv_folds),
        "--split_mode",
        args.split_mode,
        "--min_macro_f1",
        str(args.min_macro_f1),
        "--min_test_support_per_class",
        str(args.min_test_support_per_class),
        "--max_confusion_rate",
        str(args.max_confusion_rate),
    ]
    if args.manifest_path:
        train_cmd += ["--manifest_path", args.manifest_path]
    if args.allow_failed_gate:
        train_cmd += ["--allow_failed_gate"]
    _run(train_cmd)

    if not args.skip_eval:
        if args.mode in ("static", "both"):
            static_eval_cmd = base + [
                "evaluate.py",
                "--test_size",
                str(args.test_size),
                "--seed",
                str(args.seed),
                "--cv_folds",
                str(args.cv_folds),
                "--split_mode",
                args.split_mode,
            ]
            if args.manifest_path:
                static_eval_cmd += ["--manifest_path", args.manifest_path]
            _run(static_eval_cmd)
        if args.mode in ("motion", "both"):
            motion_eval_cmd = base + [
                "evaluate_motion.py",
                "--motion_seq_len",
                str(args.motion_seq_len),
                "--test_size",
                str(args.test_size),
                "--seed",
                str(args.seed),
                "--cv_folds",
                str(args.cv_folds),
                "--split_mode",
                args.split_mode,
            ]
            if args.manifest_path:
                motion_eval_cmd += ["--manifest_path", args.manifest_path]
            _run(motion_eval_cmd)
    if args.calibrate:
        _run(base + ["calibrate_decoder.py"])

    export_cmd = base + ["export.py"]
    if args.runtime_dir:
        export_cmd += ["--runtime-dir", args.runtime_dir]
    if args.strict_export:
        export_cmd += ["--strict"]
    if args.allow_failed_gate:
        export_cmd += ["--allow-failed-gate"]
    _run(export_cmd)

    print("\nPipeline completed.")


if __name__ == "__main__":
    main()
