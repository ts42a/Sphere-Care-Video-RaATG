"""Load MotionSrmStream from ai/models/SRM/test.py (motion translation pipeline)."""
from __future__ import annotations

import importlib.util
import sys
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from typing import Any

    MotionSrmStream = Any

SRM_TEST_PATH = Path(__file__).resolve().parents[2] / "ai" / "models" / "SRM" / "test.py"


@lru_cache(maxsize=1)
def _load_srm_test_module():
    spec = importlib.util.spec_from_file_location("sphere_srm_test", SRM_TEST_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load SRM test module: {SRM_TEST_PATH}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def create_motion_srm_stream() -> MotionSrmStream:
    mod = _load_srm_test_module()
    return mod.MotionSrmStream(mod.TextModelTester(mode="motion"))
