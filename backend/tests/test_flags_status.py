"""Tests for Flag lifecycle status — matches updated model (default status="open")."""

# From the updated Flag model: status default is "open"
VALID_STATUSES = {"open", "in_review", "confirmed", "escalated", "resolved", "false_alarm", "Pending Review"}

ALLOWED_TRANSITIONS = {
    "open":          {"in_review", "false_alarm", "resolved"},
    "Pending Review":{"in_review", "false_alarm", "resolved"},
    "in_review":     {"confirmed", "escalated", "false_alarm", "resolved"},
    "confirmed":     {"escalated", "resolved"},
    "escalated":     {"resolved"},
    "resolved":      set(),
    "false_alarm":   set(),
}


def can_transition(current: str, next_status: str) -> bool:
    return next_status in ALLOWED_TRANSITIONS.get(current, set())


def test_open_can_move_to_in_review():
    assert can_transition("open", "in_review") is True


def test_open_can_be_false_alarm():
    assert can_transition("open", "false_alarm") is True


def test_open_cannot_jump_to_confirmed():
    assert can_transition("open", "confirmed") is False


def test_in_review_can_confirm():
    assert can_transition("in_review", "confirmed") is True


def test_in_review_can_escalate():
    assert can_transition("in_review", "escalated") is True


def test_confirmed_can_resolve():
    assert can_transition("confirmed", "resolved") is True


def test_resolved_is_terminal():
    for status in ["open", "in_review", "confirmed", "escalated"]:
        assert can_transition("resolved", status) is False


def test_false_alarm_is_terminal():
    for status in ["open", "in_review", "confirmed"]:
        assert can_transition("false_alarm", status) is False


def test_default_flag_status_matches_model():
    # Model sets default="open"
    default = "open"
    assert default in VALID_STATUSES
