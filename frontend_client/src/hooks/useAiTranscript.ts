import { useCallback, useEffect, useState } from "react";
import { callService } from "../services/callService";
import { callSignalingService } from "../services/call/callSignalingService";
import type { TranscriptItem } from "../types/call";

function sortTranscript(items: TranscriptItem[]) {
  return [...items].sort((a, b) => a.id - b.id);
}

function upsertTranscriptItem(items: TranscriptItem[], next: TranscriptItem) {
  const existing = items.find((item) => item.id === next.id);

  if (existing) {
    return sortTranscript(
      items.map((item) => (item.id === next.id ? next : item))
    );
  }

  return sortTranscript([...items, next]);
}

export function useAiTranscript(callId?: number, enabled = true) {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [transcribing, setTranscribing] = useState(enabled);

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

  useEffect(() => {
    if (!callId || !enabled) return;

    const timer = setInterval(() => {
      load();
    }, 12000);

    return () => clearInterval(timer);
  }, [callId, enabled, load]);

  return {
    items,
    loading,
    error,
    transcribing,
    refresh: load,
  };
}