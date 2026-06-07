"""
Run static ASL (test.py parity). GUI on by default when run as a script file.

  From this folder:  py run_static.py          (fast default)
  HD / slower:       py run_static.py --quality
  API / headless:    python -m backend.asl_runtime.run_static --no-gui
"""
from pathlib import Path
import sys

if __name__ == "__main__" and __package__ is None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    argv = sys.argv[1:]
    if "--gui" not in argv and "--no-gui" not in argv:
        sys.argv.append("--gui")

from backend.asl_runtime.static_runner import main

if __name__ == "__main__":
    main()
