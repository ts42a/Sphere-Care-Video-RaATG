# Backward-compatible entry point — delegates to backend motion runner GUI.
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.asl_runtime.motion_runner import main

if __name__ == "__main__":
    main()
