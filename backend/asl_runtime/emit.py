from __future__ import annotations

import json


def emit(payload: dict) -> None:
    print(json.dumps(payload), flush=True)
