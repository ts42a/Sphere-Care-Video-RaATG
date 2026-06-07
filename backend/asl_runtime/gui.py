"""Bottom GUI bar for local --gui runs (ASCII-only text for OpenCV)."""
from __future__ import annotations

import cv2

_NOISE = frozenset({"NO_HAND", "UNKNOWN", "CAPTURING", ""})
_EMPTY = "-"

_LABEL_BGR = (100, 116, 139)
_VALUE_BGR = (15, 23, 42)
_MUTED_BGR = (148, 163, 184)
_BAR_BGR = (252, 252, 253)
_BORDER_BGR = (226, 232, 240)
_ACCENT_BGR = (1, 103, 129)
_LEFT_RATIO = 0.75
# Compact bottom bar (~14% of frame height, min 72px max 88px).
_BAR_FRAC = 0.14
_BAR_MIN_H = 72
_BAR_MAX_H = 88


def _ascii(text: str) -> str:
    """OpenCV Hershey fonts only render ASCII reliably."""
    return "".join(ch if ord(ch) < 128 else "?" for ch in str(text))


def _truncate(text: str, max_len: int = 80) -> str:
    t = _ascii((text or "").strip())
    if not t:
        return _EMPTY
    if len(t) <= max_len:
        return t
    return t[: max_len - 3] + "..."


def _put_label(img, text: str, x: int, y: int, scale: float = 0.48) -> None:
    cv2.putText(img, _ascii(text), (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, _LABEL_BGR, 1, cv2.LINE_AA)


def _put_value(img, text: str, x: int, y: int, scale: float = 0.58, color=_VALUE_BGR) -> None:
    cv2.putText(
        img,
        _ascii(text),
        (x, y),
        cv2.FONT_HERSHEY_SIMPLEX,
        scale,
        color,
        1 if scale < 0.7 else 2,
        cv2.LINE_AA,
    )


def _format_prediction_inline(prediction: str, confidence: float) -> tuple[str, tuple[int, int, int]]:
    pred = _ascii((prediction or "").strip())
    if pred.upper() in _NOISE:
        return _EMPTY, _MUTED_BGR
    pct = f" {int(confidence * 100)}%" if confidence and confidence > 0 else ""
    return f"{pred.upper()}{pct}", _ACCENT_BGR


def build_text_stream(text_buffer: str, prediction: str, *, live: bool = True) -> str:
    """Running prediction chain (e.g. aaiaddfjk) plus optional live letter."""
    base = _ascii(text_buffer)
    pred = _ascii(prediction).strip()
    if not live or pred.upper() in _NOISE:
        return base or _EMPTY
    if not base:
        return pred.upper()
    if pred.upper() in base.upper():
        return base
    if len(pred) == 1:
        return base + pred.upper()
    return base + " " + pred.upper()


def draw_bottom_gui_bar(
    frame,
    *,
    text_buffer: str = "",
    translation: str | None = None,
    text_stream: str | None = None,
    prediction: str = "",
    confidence: float = 0.0,
) -> None:
    h, w = frame.shape[:2]
    bar_h = min(_BAR_MAX_H, max(_BAR_MIN_H, int(h * _BAR_FRAC)))
    y0 = h - bar_h
    split_x = int(w * _LEFT_RATIO)

    cv2.rectangle(frame, (0, y0), (w, h), _BAR_BGR, -1)
    cv2.line(frame, (0, y0), (w, y0), _BORDER_BGR, 2)
    cv2.line(frame, (split_x, y0 + 6), (split_x, h - 6), _BORDER_BGR, 1)

    pad_x = 12
    left_max_chars = max(28, (split_x - pad_x * 2) // 7)
    trans = _truncate(translation if translation is not None else text_buffer, left_max_chars)
    stream = _truncate(text_stream if text_stream is not None else text_buffer, left_max_chars + 16)

    _put_label(frame, "Translation :", pad_x, y0 + 14)
    _put_value(frame, trans, pad_x, y0 + 30, scale=0.56)

    text_label_y = y0 + 46
    _put_label(frame, "Text :", pad_x, text_label_y)
    _put_value(frame, stream, pad_x, text_label_y + 16, scale=0.54)

    right_x = split_x + 10
    pred_inline, pred_color = _format_prediction_inline(prediction, confidence)
    _put_label(frame, "prediction key", right_x, y0 + 14, scale=0.44)
    pred_scale = 0.66 if len(pred_inline) <= 10 else 0.56
    _put_value(frame, pred_inline, right_x, y0 + 32, scale=pred_scale, color=pred_color)

    _put_value(
        frame,
        "C clear | SPACE add | Q ESC quit",
        right_x,
        h - 10,
        scale=0.42,
        color=_MUTED_BGR,
    )


def handle_gui_keys(
    key: int, text_buffer: str, smoothed: str
) -> tuple[str, bool]:
    if key in (27, ord("q")):
        return text_buffer, True
    if key == ord("c"):
        return "", False
    if key == 32 and smoothed.upper() not in _NOISE:
        token = _ascii(smoothed)
        if token and (not text_buffer or not text_buffer.endswith(token)):
            return text_buffer + token, False
    return text_buffer, False
