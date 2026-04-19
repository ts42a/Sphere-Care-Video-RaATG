import { useEffect, useMemo, useRef, useState } from "react";
import { wsClient } from "../services/wsClient";
import { callService } from "../services/callService";
import { hydrateCall } from "../api/call";
import { activeCallService } from "../services/activeCallService";
import { miniCallService } from "../services/miniCallService";
import type { CallContact, CallMode, CallSession } from "../types/call";

function formatCallTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getElapsedSeconds(session: CallSession) {
  return Math.max(0, Math.floor((Date.now() - session.startedAtMs) / 1000));
}

function matchesSession(session: CallSession | null, contact: CallContact | null, callId?: number | null) {
  if (!session || !contact) return false;
  if (callId && session.callId === callId) return true;
  if (contact.userId && session.remoteUserId) {
    return contact.userId === session.remoteUserId;
  }
  if (contact.conversationId && session.conversationId) {
    return contact.conversationId === session.conversationId;
  }
  return session.doctor.name === contact.name;
}

function isTerminal(session?: CallSession | null) {
  if (!session) return true;
  return session.ended || ["declined", "canceled", "timeout", "ended", "failed"].includes(session.callState);
}

export function useCallSession(
  contact: CallContact | null,
  _requestedMode: CallMode,
  options?: { callId?: number | null }
) {
  const callId = options?.callId ?? null;
  const [session, setSession] = useState<CallSession | null>(null);
  const [callSeconds, setCallSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const endingRef = useRef(false);

  useEffect(() => {
    if (!contact) {
      setLoading(false);
      setSession(null);
      return;
    }

    const resolvedContact = contact;
    let cancelled = false;

    async function bootstrap() {
      try {
        setLoading(true);
        setError("");

        const existing = activeCallService.getForContact(resolvedContact, callId);
        if (existing) {
          if (!cancelled) {
            setSession(existing);
            setCallSeconds(getElapsedSeconds(existing));
          }
          return;
        }

        if (callId) {
          const hydrated = await hydrateCall(callId, resolvedContact);
          if (!cancelled) {
            setSession(hydrated);
            setCallSeconds(getElapsedSeconds(hydrated));
          }
          return;
        }

        if (!cancelled) {
          setSession(null);
          setError("No active call session. Start the call from the call center first.");
        }
      } catch (err) {
        if (!cancelled) {
          setSession(null);
          setError(err instanceof Error ? err.message : "Unable to load call session");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [contact?.id, callId]);

  useEffect(() => {
    if (!contact) return;

    return activeCallService.subscribe((next) => {
      if (!next) {
        setSession((prev) => (prev ? null : prev));
        return;
      }
      if (!matchesSession(next, contact, callId)) {
        return;
      }
      setSession(next);
      if (next.callState === "active") {
        setCallSeconds(getElapsedSeconds(next));
      }
    });
  }, [contact?.id, callId]);

  useEffect(() => {
    if (!session || session.ended || session.callState !== "active") return;

    const timer = setInterval(() => {
      setCallSeconds(getElapsedSeconds(session));
    }, 1000);

    return () => clearInterval(timer);
  }, [session?.callId, session?.startedAtMs, session?.ended, session?.callState]);

  useEffect(() => {
    if (!contact) return;

    let unsubscribeAccepted = () => {};
    let unsubscribeDeclined = () => {};
    let unsubscribeCanceled = () => {};
    let unsubscribeTimeout = () => {};
    let unsubscribeEnded = () => {};
    let unsubscribeModeChanged = () => {};

    const onEvent = (type: string) => (payload: any) => {
    const payloadCallId = Number(payload?.call_id ?? payload?.callId);
    const trackedCallId =
      callId ?? activeCallService.getForContact(contact)?.callId ?? session?.callId;

    if (!trackedCallId || payloadCallId !== trackedCallId) {
      return;
    }

    const next = callService.applyRealtimeCallState({
      type,
      callId: payloadCallId,
      state: payload?.state,
      kind:
        payload?.kind === "video"
          ? "video"
          : payload?.kind === "audio"
            ? "audio"
            : undefined,
      startedAt: payload?.started_at ?? payload?.startedAt,
    });

    if (!next) {
      return;
    }

    setSession(next);

    miniCallService.setState({
      active: !next.ended,
      minimized: miniCallService.getState().minimized,
      mode: next.mode,
      callId: next.callId,
      contactId: contact.id,
      contactName: contact.name,
    });

    if (type === "call.accepted") {
      setCallSeconds(getElapsedSeconds(next));
    }

    if (
      ["call.declined", "call.canceled", "call.timeout", "call.ended"].includes(type)
    ) {
      miniCallService.clear();
    }
  };

  unsubscribeAccepted = wsClient.subscribe("call.accepted", onEvent("call.accepted"));
  unsubscribeDeclined = wsClient.subscribe("call.declined", onEvent("call.declined"));
  unsubscribeCanceled = wsClient.subscribe("call.canceled", onEvent("call.canceled"));
  unsubscribeTimeout = wsClient.subscribe("call.timeout", onEvent("call.timeout"));
  unsubscribeEnded = wsClient.subscribe("call.ended", onEvent("call.ended"));
  unsubscribeModeChanged = wsClient.subscribe("call.mode_changed", onEvent("call.mode_changed"));

    return () => {
      unsubscribeAccepted();
      unsubscribeDeclined();
      unsubscribeCanceled();
      unsubscribeTimeout();
      unsubscribeEnded();
      unsubscribeModeChanged();
    };
  }, [session?.callId, contact?.id, contact?.name, callId]);

  const formattedDuration = useMemo(() => formatCallTime(callSeconds), [callSeconds]);

  async function toggleMute() {
    if (!session) return;
    const result = await callService.muteCall(session.callId);
    setSession((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, muted: result.muted ?? prev.muted };
      activeCallService.set(updated);
      return updated;
    });
  }

  async function stopTranscribing() {
    if (!session) return;
    const result = await callService.stopCall(session.callId);
    setSession((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, transcribing: result.transcribing ?? prev.transcribing };
      activeCallService.set(updated);
      return updated;
    });
  }

  async function endCurrentCall() {
    if (!session || endingRef.current) return;

    if (isTerminal(session)) {
      activeCallService.patch({
        ended: true,
        consultationStatus: callService.getCallStatusLabel(session.callState),
      });
      miniCallService.clear();
      return;
    }

    endingRef.current = true;
    try {
      await callService.endCall(session.callId);
    } finally {
      endingRef.current = false;
      setSession((prev) => {
        if (!prev) return prev;
        const latest = activeCallService.patch({
          callState: "ended",
          ended: true,
          consultationStatus: callService.getCallStatusLabel("ended"),
        }) ?? {
          ...prev,
          callState: "ended" as const,
          ended: true,
          consultationStatus: callService.getCallStatusLabel("ended"),
        };
        miniCallService.clear();
        return latest;
      });
    }
  }

  return {
    session,
    loading,
    error,
    callSeconds,
    formattedDuration,
    muted: session?.muted ?? false,
    transcribing: session?.transcribing ?? false,
    isConnected: Boolean(session && session.callState === "active" && !session.ended),
    toggleMute,
    stopTranscribing,
    endCurrentCall,
  };
}