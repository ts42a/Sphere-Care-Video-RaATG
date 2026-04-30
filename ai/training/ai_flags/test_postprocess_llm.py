from __future__ import annotations

from ai.training.ai_flags.layers.postprocess import AlphaPathProcessor, LLMGeneralSummary, LLMIncidentNarrative
from ai.training.ai_flags.layers.types import TriagedEvent


def _alpha_event() -> TriagedEvent:
    return TriagedEvent(
        event_id="evt_1",
        event_type="fall_risk",
        level="alpha",
        confidence=0.9,
        zone="room_a",
        ts=10.0,
        evidence={"source": "unit_test"},
    )


def test_incident_narrative_uses_llm_json_when_enabled(monkeypatch) -> None:
    monkeypatch.setenv("AI_FLAGS_USE_LLM", "true")
    monkeypatch.setenv("AI_FLAGS_LLM_MODE", "incident")

    def _fake_chat_once(_prompt: str, *, system_prompt: str = "") -> str:
        assert "strict JSON" in system_prompt
        return '{"title":"Incident","summary":"Possible fall near bed.","body":"Staff review recommended."}'

    monkeypatch.setattr("ai.training.ai_flags.layers.postprocess._chat_once", _fake_chat_once)

    out = AlphaPathProcessor(cooldown_seconds=1.0).process([_alpha_event()])
    summary = str(out["incident_report"]["summary"])
    assert "Possible fall near bed." in summary
    assert "Staff review recommended." in summary


def test_incident_narrative_falls_back_on_invalid_json(monkeypatch) -> None:
    monkeypatch.setenv("AI_FLAGS_USE_LLM", "true")
    monkeypatch.setenv("AI_FLAGS_LLM_MODE", "incident")
    monkeypatch.setattr(
        "ai.training.ai_flags.layers.postprocess._chat_once",
        lambda _prompt, system_prompt="": "not-json-response",
    )

    out = AlphaPathProcessor(cooldown_seconds=1.0).process([_alpha_event()])
    summary = str(out["incident_report"]["summary"])
    assert "Possible fall_risk observed in room_a" in summary


def test_observation_summary_uses_llm_json_when_enabled(monkeypatch) -> None:
    monkeypatch.setenv("AI_FLAGS_USE_LLM", "true")
    monkeypatch.setenv("AI_FLAGS_LLM_MODE", "observation")

    def _fake_chat_once(_prompt: str, *, system_prompt: str = "") -> str:
        assert "strict JSON" in system_prompt
        return '{"summary":"No confirmed incident.","notes":"Frequent motion near doorway."}'

    monkeypatch.setattr("ai.training.ai_flags.layers.postprocess._chat_once", _fake_chat_once)

    text = LLMGeneralSummary.generate(
        [{"summary": "Chunk 0: observed non-confirmed events near doorway."}]
    )
    assert "No confirmed incident." in text
    assert "Frequent motion near doorway." in text


def test_incident_narrative_disabled_uses_fallback(monkeypatch) -> None:
    monkeypatch.setenv("AI_FLAGS_USE_LLM", "false")
    out = LLMIncidentNarrative.generate(
        [{"event_type": "fall_risk", "zone": "room_a", "start_sec": 1.0, "end_sec": 2.0, "severity": "High"}]
    )
    assert "Possible fall_risk observed in room_a" in out
