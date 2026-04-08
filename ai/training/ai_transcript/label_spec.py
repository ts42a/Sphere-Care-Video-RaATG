from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent
LABEL_SPEC_PATH = ROOT / "labels_v1.json"


@dataclass(frozen=True)
class LabelSpec:
    version: str
    static_labels: list[str]
    motion_labels: list[str]
    aliases: dict[str, str]


def _clean_token(token: str) -> str:
    token = token.strip().upper()
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
    return "".join(ch for ch in token if ch in allowed)


def load_label_spec(path: Path = LABEL_SPEC_PATH) -> LabelSpec:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return LabelSpec(
        version=str(data.get("version", "labels_v1")),
        static_labels=[str(v).upper() for v in data.get("static_labels", [])],
        motion_labels=[str(v).upper() for v in data.get("motion_labels", [])],
        aliases={str(k).upper(): str(v).upper() for k, v in data.get("aliases", {}).items()},
    )


def canonicalize_static_label(raw: str, *, spec: LabelSpec | None = None) -> str:
    spec = spec or load_label_spec()
    value = _clean_token(raw)
    value = spec.aliases.get(value, value)
    if value not in set(spec.static_labels):
        raise ValueError(
            f"Static label '{raw}' is not in labels spec. Allowed: {', '.join(spec.static_labels)}"
        )
    return value


def canonicalize_motion_label(raw: str, *, spec: LabelSpec | None = None) -> str:
    spec = spec or load_label_spec()
    value = _clean_token(raw)
    value = spec.aliases.get(value, value)
    if value not in set(spec.motion_labels):
        raise ValueError(
            f"Motion label '{raw}' is not in labels spec. Allowed: {', '.join(spec.motion_labels)}"
        )
    return value


def canonicalize_motion_label_relaxed(raw: str, *, spec: LabelSpec | None = None) -> str:
    """
    Canonicalize motion token without enforcing membership in spec.motion_labels.
    Useful during collection when the vocabulary is still evolving.
    """
    spec = spec or load_label_spec()
    value = _clean_token(raw)
    value = spec.aliases.get(value, value)
    if not value:
        raise ValueError("Motion label cannot be empty.")
    return value
