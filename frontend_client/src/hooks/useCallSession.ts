import { useEffect, useMemo, useState } from "react";
import { getStoredUser } from "../services/sessionService";
import { callService } from "../services/callService";
import { activeCallService } from "../services/activeCallService";
import { miniCallService } from "../services/miniCallService";
import type { AuthUser } from "../types/auth";
import type { CallContact, CallMode, CallSession } from "../types/call";

function getInitials(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "CU"
  );
}

function formatCallTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getElapsedSeconds(session: CallSession) {
  return Math.max(0, Math.floor((Date.now() - session.startedAtMs) / 1000));
}

function isSameDoctor(session: CallSession | null, contact: CallContact | null) {
  if (!session || !contact) return false;
  return session.doctor.name === contact.name;
}

export function useCallSession(contact: CallContact | null, mode: CallMode) {
  const [session, setSession] = useState<CallSession | null>(null);
  const [callSeconds, setCallSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!contact) return;

    let cancelled = false;

    async function bootstrap() {
      try {
        setLoading(true);
        setError("");

        const existing = activeCallService.get();

        if (existing && !existing.ended && isSameDoctor(existing, contact)) {
          const reusedSession: CallSession = {
            ...existing,
            mode,
          };

          activeCallService.set(reusedSession);

          miniCallService.setState({
            active: true,
            minimized: false,
            mode,
            contactId: contact.id,
            contactName: contact.name,
          });

          if (cancelled) return;

          setSession(reusedSession);
          setCallSeconds(getElapsedSeconds(reusedSession));
          return;
        }

        const backendCurrent = await callService.getCurrentCall();

        if (backendCurrent && !backendCurrent.ended && isSameDoctor(backendCurrent, contact)) {
          const restoredSession: CallSession = {
            ...backendCurrent,
            mode: backendCurrent.mode ?? mode,
            startedAtMs: backendCurrent.startedAtMs || Date.now(),
          };

          activeCallService.set(restoredSession);

          miniCallService.setState({
            active: true,
            minimized: false,
            mode: restoredSession.mode,
            contactId: contact.id,
            contactName: contact.name,
          });

          if (cancelled) return;

          setSession(restoredSession);
          setCallSeconds(getElapsedSeconds(restoredSession));
          return;
        }

        const user = await getStoredUser<AuthUser>();
        const patientName = user?.full_name || "Client User";

        const data = await callService.startCall({
          mode,
          doctorName: contact.name,
          doctorInitials: contact.initials,
          patientName,
          patientInitials: getInitials(patientName),
        });

        if (cancelled) return;

        const nextSession: CallSession = {
          ...data,
          mode,
          startedAtMs: data.startedAtMs || Date.now(),
        };

        setSession(nextSession);
        activeCallService.set(nextSession);

        miniCallService.setState({
          active: true,
          minimized: false,
          mode,
          contactId: contact.id,
          contactName: contact.name,
        });

        setCallSeconds(0);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unable to start call");
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
  }, [contact?.id, mode]);

  useEffect(() => {
    if (!session || session.ended) return;

    const timer = setInterval(() => {
      setCallSeconds(getElapsedSeconds(session));
    }, 1000);

    return () => clearInterval(timer);
  }, [session?.callId, session?.startedAtMs, session?.ended]);

  const formattedDuration = useMemo(() => formatCallTime(callSeconds), [callSeconds]);

  async function toggleMute() {
    if (!session) return;

    const result = await callService.muteCall(session.callId);

    setSession((prev) => {
      if (!prev) return prev;

      const updated: CallSession = {
        ...prev,
        muted: result.muted ?? prev.muted,
      };

      activeCallService.set(updated);
      return updated;
    });
  }

  async function stopTranscribing() {
    if (!session) return;

    const result = await callService.stopCall(session.callId);

    setSession((prev) => {
      if (!prev) return prev;

      const updated: CallSession = {
        ...prev,
        transcribing: result.transcribing ?? prev.transcribing,
      };

      activeCallService.set(updated);
      return updated;
    });
  }

  function minimizeCurrentCall() {
    if (!session || !contact) return;

    miniCallService.setState({
      active: true,
      minimized: true,
      mode: session.mode,
      contactId: contact.id,
      contactName: contact.name,
    });

    activeCallService.patch({
      mode: session.mode,
    });
  }

  function restoreCurrentCall() {
    if (!session || !contact) return;

    miniCallService.setState({
      active: true,
      minimized: false,
      mode: session.mode,
      contactId: contact.id,
      contactName: contact.name,
    });
  }

  async function endCurrentCall() {
    if (!session) return;

    await callService.endCall(session.callId);

    setSession((prev) => {
      if (!prev) return prev;

      const updated: CallSession = {
        ...prev,
        ended: true,
        consultationStatus: "Consultation ended",
      };

      activeCallService.clear();
      miniCallService.clear();
      return updated;
    });
  }

  return {
    session,
    loading,
    error,
    callSeconds,
    formattedDuration,
    muted: session?.muted ?? false,
    transcribing: session?.transcribing ?? false,
    isConnected: Boolean(session && !session.ended),
    toggleMute,
    stopTranscribing,
    minimizeCurrentCall,
    restoreCurrentCall,
    endCurrentCall,
  };
}