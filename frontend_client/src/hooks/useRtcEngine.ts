import { useEffect, useState } from "react";
import type { RtcEngine, RtcEngineSnapshot, RtcJoinOptions } from "../services/rtc/rtcEngine";

export function useRtcEngine(engine: RtcEngine, options?: RtcJoinOptions) {
  const [snapshot, setSnapshot] = useState<RtcEngineSnapshot>(engine.getSnapshot());
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = engine.subscribe(setSnapshot);
    return unsubscribe;
  }, [engine]);

  useEffect(() => {
    let cancelled = false;

    async function join() {
      if (!options) return;

      try {
        setJoining(true);
        setError("");
        await engine.joinCall(options);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to join RTC call");
        }
      } finally {
        if (!cancelled) {
          setJoining(false);
        }
      }
    }

    join();

    return () => {
      cancelled = true;
    };
  }, [engine, options?.callId, options?.mode, options?.localUserId, options?.remoteUserId]);

  return {
    snapshot,
    joining,
    error,
    leaveCall: () => engine.leaveCall(),
    setMuted: (muted: boolean) => engine.setMuted(muted),
    setCameraEnabled: (enabled: boolean) => engine.setCameraEnabled(enabled),
    switchCamera: () => engine.switchCamera(),
    setRemoteVideoEnabled: (enabled: boolean) => engine.setRemoteVideoEnabled(enabled),
  };
}