/**
 * src/hooks/useAiTranscript.ts
 *
 * Extends the original hook with real-time ASR + ASL support.
 *
 * New behaviour:
 *   - Subscribes to `call.caption`    → Whisper ASR segments
 *   - Subscribes to `call.asl.result` → ASL gesture results
 *   - Both arrive via wsClient.subscribe() — same WS connection already open
 *   - Existing polling (every 12s) and callSignalingService.onTranscriptUpdated
 *     are kept unchanged for backwards compatibility
 */

import { useCallback, useEffect, useState } from "react";
import { callService } from "../services/callService";
import { callSignalingService } from "../services/call/callSignalingService";
import { wsClient } from "../services/wsClient";
import type { TranscriptItem } from "../types/call";

function sortTranscript(items: TranscriptItem[]) {
  return [...items].sort((a, b) => a.id - b.id);
}

function upsertTranscriptItem(items: TranscriptItem[], next: TranscriptItem) {
  const existing = items.find((item) => item.id === next.id);
  if (existing) {
    return sortTranscript(items.map((item) => (item.id === next.id ? next : item)));
  }
  return sortTranscript([...items, next]);
}

// Auto-incrementing id for real-time items (avoids collision with DB ids)
let _rtId = -1;
function nextRtId() {
  return _rtId--;
}

function formatTs(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export function useAiTranscript(callId?: number, enabled = true) {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [transcribing, setTranscribing] = useState(enabled);

  // ── Initial load from server ───────────────────────────────────────────
  const load = useCallback(async () => {
    if (!callId) return;
    try {
      setError("");
      setLoading(true);
      const data = await callService.getTranscript(callId);
      setItems(sortTranscript(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load transcript");
    } finally {
      setLoading(false);
    }
  }, [callId]);

  useEffect(() => {
    setTranscribing(enabled);
  }, [enabled]);

  // ── callSignalingService (existing) ───────────────────────────────────
  useEffect(() => {
    if (!callId) return;

    load();

    const unsubscribe = callSignalingService.subscribe(String(callId), {
      onTranscriptUpdated: (item) => {
        setItems((prev) => upsertTranscriptItem(prev, item));
      },
      onTranscribingUpdated: (next) => {
        setTranscribing(next);
      },
      onEnded: () => {
        setTranscribing(false);
      },
    });

    return unsubscribe;
  }, [callId, load]);

  // ── Polling fallback (existing) ────────────────────────────────────────
  useEffect(() => {
    if (!callId || !enabled) return;
    const timer = setInterval(load, 12000);
    return () => clearInterval(timer);
  }, [callId, enabled, load]);

  // ── NEW: call.caption — Whisper ASR real-time segments ────────────────
  useEffect(() => {
    if (!callId || !enabled) return;

    const unsubscribe = wsClient.subscribe("call.caption", (msg) => {
      const p = msg?.payload ?? msg;

      // Only process segments for this call
      if (!p || String(p.call_id) !== String(callId)) return;
      if (!p.text) return;

      const item: TranscriptItem = {
        id: nextRtId(),
        // @ts-ignore — extend TranscriptItem with source if you want styling
        source: "asr",
        speaker: p.speaker ?? "Staff",
        text: p.text,
        timestamp: formatTs(p.ts ?? Date.now() / 1000),
        confidence: p.confidence,
      };

      setItems((prev) => upsertTranscriptItem(prev, item));
    });

    return unsubscribe;
  }, [callId, enabled]);

  // ── NEW: call.asl.result — ASL gesture real-time segments ─────────────
  useEffect(() => {
    if (!callId || !enabled) return;

    const unsubscribe = wsClient.subscribe("call.asl.result", (msg) => {
      const p = msg?.payload ?? msg;

      if (!p || String(p.call_id) !== String(callId)) return;
      if (!p.letter) return;

      const displayText = p.word
        ? `[ASL] ${p.word}`
        : `[ASL] ${p.letter}`;

      const item: TranscriptItem = {
        id: nextRtId(),
        // @ts-ignore
        source: "asl",
        speaker: p.speaker ?? "ASL",
        text: displayText,
        timestamp: formatTs(p.ts ?? Date.now() / 1000),
        confidence: p.confidence,
      };

      setItems((prev) => upsertTranscriptItem(prev, item));
    });

    return unsubscribe;
  }, [callId, enabled]);

  // ── Reset on call change ───────────────────────────────────────────────
  useEffect(() => {
    setItems([]);
    setError("");
  }, [callId]);

  return {
    items,
    loading,
    error,
    transcribing,
    refresh: load,
  };
}