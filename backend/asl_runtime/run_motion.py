"""
Run motion ASL (test_motion.py parity). GUI on by default when run as a script file.

  From this folder:  py run_motion.py
  (Uses the same code path as test_motion.py; only the bottom bar GUI differs.)

  Headless/API:      py run_motion.py --no-gui
  From repo root:    python -m backend.asl_runtime.run_motion --gui
  API / headless:    python -m backend.asl_runtime.run_motion --no-gui
"""
from pathlib import Path
import sys

if __name__ == "__main__" and __package__ is None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    argv = sys.argv[1:]
    if "--gui" not in argv and "--no-gui" not in argv:
        sys.argv.append("--gui")

from backend.asl_runtime.motion_runner import main

if __name__ == "__main__":
    main()
