"""Tests for SCVAM flag_utils."""
from unittest.mock import MagicMock

from backend.services.scvam.flag_utils import primary_scvam_flag


def _flag(event_type: str, severity: str = "High"):
    f = MagicMock()
    f.event_type = event_type
    f.severity = severity
    return f


def test_primary_scvam_flag_prefers_fall():
    flags = [_flag("Prolonged Immobility"), _flag("Fall Like")]
    top = primary_scvam_flag(flags)
    assert top.event_type == "Fall Like"


def test_primary_scvam_flag_single():
    flags = [_flag("Sharp Object In Hand")]
    assert primary_scvam_flag(flags) is flags[0]
