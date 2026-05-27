/**
 * src/hooks/useAiTranscript.ts
 *
 * Live transcript hook shared by the current phase A backend and a future
 * streaming STT backend.
 *
 * Phase A: backend emits only final `call.caption` events.
 * Phase B: backend may emit interim and final events with the same `segment_id`.
 * This hook already upserts by segment id so upgrading the backend later does
 * not require redesigning the frontend transcript state.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { callService } from "../services/callService";
import { callSignalingService } from "../services/call/callSignalingService";
import { wsClient } from "../services/wsClient";
import type { TranscriptItem } from "../types/call";

type LiveTranscriptItem = TranscriptItem & {
  segmentId?: string;
  source?: "asr" | "asl";
  isFinal?: boolean;
  confidence?: number;
};

function sortTranscript(items: LiveTranscriptItem[]) {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.created_at).getTime();
    const bTime = new Date(b.created_at).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return a.id - b.id;
  });
}

function upsertTranscriptItem(items: LiveTranscriptItem[], next: LiveTranscriptItem) {
  const existing = next.segmentId
    ? items.find((item) => item.segmentId === next.segmentId)
    : items.find((item) => item.id === next.id);

  if (existing) {
    return sortTranscript(
      items.map((item) =>
        item.segmentId === next.segmentId || item.id === next.id ? { ...item, ...next } : item
      )
    );
  }

  return sortTranscript([...items, next]);
}

let _rtId = -1;
function nextRtId() {
  return _rtId--;
}

function toIso(unixSec?: number): string {
  const raw = Number(unixSec);
  const seconds = Number.isFinite(raw) ? raw : Date.now() / 1000;
  return new Date(seconds * 1000).toISOString();
}

function roleFromPayload(value: unknown): TranscriptItem["role"] {
  const role = String(value ?? "").toLowerCase();
  if (role === "client" || role === "patient" || role === "resident") return "patient";
  if (role === "staff" || role === "admin" || role === "doctor" || role === "provider") return "doctor";
  return "ai";
}

function normaliseLoadedItem(item: TranscriptItem): LiveTranscriptItem {
  return item;
}

export function useAiTranscript(callId?: number, enabled = true) {
  const [items, setItems] = useState<LiveTranscriptItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [transcribing, setTranscribing] = useState(enabled);

  const load = useCallback(async () => {
    if (!callId) return;
    try {
      setError("");
      setLoading(true);
      const data = await callService.getTranscript(callId);
      setItems(sortTranscript(data.map(normaliseLoadedItem)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load transcript");
    } finally {
      setLoading(false);
    }
  }, [callId]);

  useEffect(() => {
    setTranscribing(enabled);
  }, [enabled]);

  useEffect(() => {
    if (!callId) return;

    load();

    const unsubscribe = callSignalingService.subscribe(String(callId), {
      onTranscriptUpdated: (item) => {
        setItems((prev) => upsertTranscriptItem(prev, normaliseLoadedItem(item)));
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

  useEffect(() => {
    if (!callId || !enabled) return;
    const timer = setInterval(load, 12000);
    return () => clearInterval(timer);
  }, [callId, enabled, load]);

  useEffect(() => {
    if (!callId || !enabled) return;

    const unsubscribe = wsClient.subscribe("call.caption", (msg) => {
      const p = msg?.payload ?? msg;
      if (!p || String(p.call_id) !== String(callId) || !p.text) return;

      const item: LiveTranscriptItem = {
        id: nextRtId(),
        segmentId: p.segment_id,
        source: "asr",
        speaker: p.speaker_name ?? p.speaker ?? "Unknown speaker",
        role: roleFromPayload(p.participant_role),
        content: p.text,
        created_at: toIso(p.ts),
        isFinal: p.is_final ?? true,
        confidence: p.confidence,
      };

      setItems((prev) => upsertTranscriptItem(prev, item));
      console.log("[mobile transcript] call.caption received", msg);
    });

    return unsubscribe;
  }, [callId, enabled]);

  useEffect(() => {
    if (!callId || !enabled) return;

    const unsubscribe = wsClient.subscribe("call.asl.result", (msg) => {
      const p = msg?.payload ?? msg;
      if (!p || String(p.call_id) !== String(callId) || !p.letter) return;

      const item: LiveTranscriptItem = {
        id: nextRtId(),
        segmentId: p.segment_id,
        source: "asl",
        speaker: p.speaker ?? "ASL",
        role: "ai",
        content: p.word ? `[ASL] ${p.word}` : `[ASL] ${p.letter}`,
        created_at: toIso(p.ts),
        isFinal: true,
        confidence: p.confidence,
      };

      setItems((prev) => upsertTranscriptItem(prev, item));
    });

    return unsubscribe;
  }, [callId, enabled]);

  useEffect(() => {
    setItems([]);
    setError("");
  }, [callId]);

  const visibleItems = useMemo(() => items, [items]);

  return {
    items: visibleItems,
    loading,
    error,
    transcribing,
    refresh: load,
  };
}