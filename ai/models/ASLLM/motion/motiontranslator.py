from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path


def main() -> None:
    # Keep UTF-8 console behavior on Windows.
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

    repo_root = Path(__file__).resolve().parents[4]
    impl_path = repo_root / "ai" / "training" / "ai_transcript" / "test_motion.py"
    if not impl_path.exists():
        raise FileNotFoundError(f"Motion translator implementation not found: {impl_path}")
    impl_parent = str(impl_path.parent)
    if impl_parent not in sys.path:
        sys.path.insert(0, impl_parent)

    # Motion runtime should be non-interactive/minimal by default.
    extra = []
    if "--no-session-save" not in sys.argv[1:]:
        extra.append("--no-session-save")
    sys.argv = [str(impl_path)] + extra + sys.argv[1:]
    runpy.run_path(str(impl_path), run_name="__main__")


if __name__ == "__main__":
    main()
