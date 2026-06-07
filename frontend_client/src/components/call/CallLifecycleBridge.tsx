import { useEffect } from "react";
import { usePathname, useRouter } from "expo-router";

import { getAccessToken } from "../../services/sessionService";
import { wsClient } from "../../services/wsClient";
import { callService } from "../../services/callService";
import { activeCallService } from "../../services/activeCallService";
import { miniCallService } from "../../services/miniCallService";
import { incomingCallService } from "../../services/call/incomingCallService";
import { rtcEngine } from "../../services/rtc/rtcEngineInstance";
import { callSummaryState } from "../../services/callSummaryState";
import type { CallMode, CallSession } from "../../types/call";

function resolvePayloadCallId(payload: any) {
  const value = Number(payload?.call_id ?? payload?.callId);
  return Number.isFinite(value) ? value : null;
}

function resolvePayloadKind(payload: any): CallMode | undefined {
  if (payload?.kind === "video") return "video";
  if (payload?.kind === "audio") return "audio";
  return undefined;
}

function isTerminalEvent(type: string) {
  return (
    type === "call.declined" ||
    type === "call.canceled" ||
    type === "call.timeout" ||
    type === "call.ended" ||
    type === "call_ended"
  );
}

function resolveTerminalState(type: string): CallSession["callState"] {
  if (type === "call.declined") return "declined";
  if (type === "call.canceled") return "canceled";
  if (type === "call.timeout") return "timeout";
  return "ended";
}

export default function CallLifecycleBridge() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let unsubAccepted = () => {};
    let unsubDeclined = () => {};
    let unsubCanceled = () => {};
    let unsubTimeout = () => {};
    let unsubEnded = () => {};
    let unsubLegacyEnded = () => {};
    let unsubModeChanged = () => {};
    let cancelled = false;

    async function syncRealtimeEvent(type: string, payload: any) {
      const payloadCallId = resolvePayloadCallId(payload);
      if (!payloadCallId) return;

      const current = activeCallService.get();
      if (!current || current.callId !== payloadCallId) {
        if (isTerminalEvent(type)) {
          incomingCallService.clear(payloadCallId);
        }
        return;
      }

      const next = callService.applyRealtimeCallState({
        type,
        callId: payloadCallId,
        state: isTerminalEvent(type)
          ? resolveTerminalState(type)
          : payload?.state,
        kind: resolvePayloadKind(payload),
        startedAt: payload?.started_at ?? payload?.startedAt,
      });

      if (next) {
        const miniState = miniCallService.getState();

        miniCallService.setState({
          active: !next.ended,
          minimized: miniState.minimized,
          mode: next.mode,
          callId: next.callId,
          contactId:
            miniState.contactId ??
            (next.remoteUserId ? `user-${next.remoteUserId}` : String(next.callId)),
          contactName: miniState.contactName ?? next.doctor.name,
        });
      }

      if (!isTerminalEvent(type)) {
        return;
      }

      incomingCallService.clear(payloadCallId);
      miniCallService.clear();

      try {
        await rtcEngine.leaveCall();
      } catch (error) {
        console.warn("Failed to leave RTC room after terminal event", error);
      }

      const currentPath = pathname || "";
      const onCallScreen =
        currentPath.startsWith("/call/audio") ||
        currentPath.startsWith("/call/video");

      if (onCallScreen && !cancelled) {
        setTimeout(() => {
          if (!cancelled && !callSummaryState.getSummaryVisible()) {
            router.replace("/call");
          }
        }, 350);
      }
    }

    async function setup() {
      try {
        const token = await getAccessToken();
        if (!token || cancelled) return;

        await wsClient.connect();

        unsubAccepted = wsClient.subscribe("call.accepted", (payload) => {
          void syncRealtimeEvent("call.accepted", payload);
        });

        unsubDeclined = wsClient.subscribe("call.declined", (payload) => {
          void syncRealtimeEvent("call.declined", payload);
        });

        unsubCanceled = wsClient.subscribe("call.canceled", (payload) => {
          void syncRealtimeEvent("call.canceled", payload);
        });

        unsubTimeout = wsClient.subscribe("call.timeout", (payload) => {
          void syncRealtimeEvent("call.timeout", payload);
        });

        unsubEnded = wsClient.subscribe("call.ended", (payload) => {
          void syncRealtimeEvent("call.ended", payload);
        });

        unsubLegacyEnded = wsClient.subscribe("call_ended", (payload) => {
          void syncRealtimeEvent("call_ended", payload);
        });

        unsubModeChanged = wsClient.subscribe("call.mode_changed", (payload) => {
          void syncRealtimeEvent("call.mode_changed", payload);
        });
      } catch (error) {
        console.warn("CallLifecycleBridge setup failed", error);
      }
    }

    void setup();

    return () => {
      cancelled = true;
      unsubAccepted();
      unsubDeclined();
      unsubCanceled();
      unsubTimeout();
      unsubEnded();
      unsubLegacyEnded();
      unsubModeChanged();
    };
  }, [pathname, router]);

  return null;
}