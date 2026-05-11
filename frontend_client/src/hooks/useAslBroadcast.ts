/**
 * src/hooks/useAslBroadcast.ts
 *
 * Sends ASL video frames via wsClient.send() and assembles
 * received letters into words via wsClient.subscribe("call.asl.result").
 *
 * Backend: ws.py → _handle_asl_frame → asl.py → call.asl.result broadcast
 *
 * Usage:
 *   const { sendFrame, aslWord } = useAslBroadcast(callId, { enabled });
 *
 * sendFrame(base64Jpeg, mode?, motionSeq?) — call from camera frame handler
 * aslWord — running assembled word (resets after silence)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { wsClient } from "../services/wsClient";

const WORD_BREAK_MS = 1200;  // space inserted after silence
const MAX_WORD_LEN  = 60;

interface AslBroadcastOptions {
  enabled: boolean;
}

export interface AslSegment {
  speaker: string;
  letter: string;
  word: string | null;
  confidence: number;
  ts: number;
}

export function useAslBroadcast(
  callId: string | number | undefined,
  options: AslBroadcastOptions
) {
  const { enabled } = options;
  const letterBuffer = useRef("");
  const wordBreakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [aslWord, setAslWord] = useState("");
  const [lastSegment, setLastSegment] = useState<AslSegment | null>(null);

  // ── Send a frame to the backend ───────────────────────────────────────
  const sendFrame = useCallback(
    (
      imageB64: string,
      mode: "static" | "motion" = "static",
      motionSeq?: number[][]
    ) => {
      if (!callId || !enabled) return;

      wsClient.send({
        type: "asl_frame",
        payload: {
          call_id: String(callId),
          image_b64: imageB64,
          mode,
          motion_seq: motionSeq ?? [],
        },
      }).catch((err) => {
        console.warn("[useAslBroadcast] sendFrame error:", err);
      });
    },
    [callId, enabled]
  );

  // ── Receive broadcast results ─────────────────────────────────────────
  useEffect(() => {
    if (!callId || !enabled) return;

    const unsubscribe = wsClient.subscribe("call.asl.result", (msg) => {
      const p = msg?.payload ?? msg;
      if (!p || String(p.call_id) !== String(callId)) return;
      if (!p.letter) return;

      // Word assembly
      if (wordBreakTimer.current) clearTimeout(wordBreakTimer.current);

      letterBuffer.current = (letterBuffer.current + p.letter).slice(-MAX_WORD_LEN);
      const currentWord = letterBuffer.current;

      setAslWord(currentWord);
      setLastSegment({
        speaker:    p.speaker,
        letter:     p.letter,
        word:       p.word ?? null,
        confidence: p.confidence,
        ts:         p.ts,
      });

      wordBreakTimer.current = setTimeout(() => {
        letterBuffer.current += " ";
        setAslWord((prev) => prev + " ");
      }, WORD_BREAK_MS);
    });

    return unsubscribe;
  }, [callId, enabled]);

  // ── Reset on call change ──────────────────────────────────────────────
  useEffect(() => {
    letterBuffer.current = "";
    setAslWord("");
    setLastSegment(null);
    if (wordBreakTimer.current) clearTimeout(wordBreakTimer.current);
  }, [callId, enabled]);

  return { sendFrame, aslWord, lastSegment };
}