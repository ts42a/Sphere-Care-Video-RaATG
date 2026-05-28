from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path


def main() -> None:
    # Keep UTF-8 console behavior on Windows.
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

    # Route execution to the existing production-tested translator implementation.
    repo_root = Path(__file__).resolve().parents[4]
    impl_path = repo_root / "ai" / "training" / "ai_transcript" / "statictranslator.py"
    if not impl_path.exists():
        raise FileNotFoundError(f"Static translator implementation not found: {impl_path}")

    # Ensure current invocation args are forwarded.
    sys.argv = [str(impl_path)] + sys.argv[1:]
    runpy.run_path(str(impl_path), run_name="__main__")


if __name__ == "__main__":
    main()
