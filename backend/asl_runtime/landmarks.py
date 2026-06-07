"""
Hand skeleton + motion pose overlay (same as dataset_builder.draw_hand_landmarks).
"""
from __future__ import annotations

import cv2
import numpy as np

try:
    import mediapipe as mp
except ImportError:
    mp = None  # type: ignore

MOTION_NUM_HANDS = 2
MOTION_POSE_LANDMARKS = [0, 11, 12, 13, 14, 15, 16]

HAND_CONNECTIONS_FALLBACK = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
]


def _hand_connections():
    try:
        solutions = getattr(mp, "solutions", None) if mp else None
        if solutions is not None and hasattr(solutions, "hands"):
            return list(solutions.hands.HAND_CONNECTIONS)
    except Exception:
        pass
    return HAND_CONNECTIONS_FALLBACK


def draw_hand_landmarks(frame, hand_landmarks_list) -> None:
    if not hand_landmarks_list:
        return
    hand_connections = _hand_connections()
    h, w = frame.shape[:2]
    colors = [(0, 220, 0), (0, 180, 255)]
    for hand_idx, hand_landmarks in enumerate(hand_landmarks_list[:MOTION_NUM_HANDS]):
        color = colors[hand_idx % len(colors)]
        for a, b in hand_connections:
            ax = int(hand_landmarks[a].x * w)
            ay = int(hand_landmarks[a].y * h)
            bx = int(hand_landmarks[b].x * w)
            by = int(hand_landmarks[b].y * h)
            cv2.line(frame, (ax, ay), (bx, by), color, 3, cv2.LINE_AA)
        for lm in hand_landmarks:
            x = int(lm.x * w)
            y = int(lm.y * h)
            cv2.circle(frame, (x, y), 5, color, -1, cv2.LINE_AA)
            cv2.circle(frame, (x, y), 6, (255, 255, 255), 1, cv2.LINE_AA)


def draw_static_target_overlay(
    frame: np.ndarray,
    hand_landmarks=None,
    zone_state: dict | None = None,
) -> bool:
    h, w = frame.shape[:2]
    cx, cy = w // 2, h // 2
    box_w = int(w * 0.38)
    box_h = int(h * 0.5)
    x1, y1 = cx - box_w // 2, cy - box_h // 2
    x2, y2 = cx + box_w // 2, cy + box_h // 2

    in_zone = False
    hand_pt: tuple[int, int] | None = None
    if hand_landmarks:
        xs = [int(lm.x * w) for lm in hand_landmarks]
        ys = [int(lm.y * h) for lm in hand_landmarks]
        if xs and ys:
            hand_pt = (int(np.mean(xs)), int(np.mean(ys)))
            in_zone = x1 <= hand_pt[0] <= x2 and y1 <= hand_pt[1] <= y2

    stable_in = in_zone
    if zone_state is not None:
        score = int(zone_state.get("score", 0))
        if in_zone:
            score = min(6, score + 1)
        else:
            score = max(-6, score - 1)
        zone_state["score"] = score
        stable_in = score >= 2
    box_color = (0, 220, 0) if stable_in else (0, 200, 255)
    cv2.rectangle(frame, (x1, y1), (x2, y2), box_color, 2, cv2.LINE_AA)
    cv2.line(frame, (cx - 22, cy), (cx + 22, cy), box_color, 2, cv2.LINE_AA)
    cv2.line(frame, (cx, cy - 22), (cx, cy + 22), box_color, 2, cv2.LINE_AA)

    if hand_pt is not None:
        cv2.circle(frame, hand_pt, 5, (255, 255, 255), -1, cv2.LINE_AA)
        cv2.circle(frame, hand_pt, 7, (20, 20, 20), 1, cv2.LINE_AA)
    return in_zone


def draw_motion_pose_overlay(frame: np.ndarray, pose_landmarks) -> None:
    if not pose_landmarks:
        return
    need = max(MOTION_POSE_LANDMARKS) + 1
    try:
        n = len(pose_landmarks)
    except TypeError:
        return
    if n < need:
        return
    h, w = frame.shape[:2]
    pts: list[tuple[int, int]] = []
    for i in MOTION_POSE_LANDMARKS:
        lm = pose_landmarks[i]
        pts.append((int(lm.x * w), int(lm.y * h)))
    edges = [(1, 2), (0, 1), (0, 2), (1, 3), (3, 5), (2, 4), (4, 6)]
    color = (255, 255, 0)
    for a, b in edges:
        if 0 <= a < len(pts) and 0 <= b < len(pts):
            cv2.line(frame, pts[a], pts[b], color, 3, cv2.LINE_AA)
    for p in pts:
        cv2.circle(frame, p, 5, color, -1, cv2.LINE_AA)
        cv2.circle(frame, p, 6, (255, 255, 255), 1, cv2.LINE_AA)


def draw_detection_overlay(
    frame,
    hand_landmarks_list,
    pose_landmarks=None,
    *,
    static_target: bool = False,
    zone_state: dict | None = None,
) -> None:
    """Hands (points + lines); optional static target box; optional motion pose."""
    if hand_landmarks_list:
        draw_hand_landmarks(frame, hand_landmarks_list)
        if static_target:
            draw_static_target_overlay(frame, hand_landmarks_list[0], zone_state=zone_state)
    if pose_landmarks is not None:
        draw_motion_pose_overlay(frame, pose_landmarks)
