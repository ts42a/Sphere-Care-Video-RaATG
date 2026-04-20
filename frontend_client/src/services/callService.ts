import { getStoredUser } from "./sessionService";
import { activeCallService } from "./activeCallService";
import type { AuthUser } from "../types/auth";
import type {
  CallContact,
  CallLifecycleState,
  CallMode,
  CallSession,
  StartCallPayload,
} from "../types/call";
import {
  acceptCallRequest,
  buildSession,
  cancelCallRequest,
  declineCallRequest,
  endCallRequest,
  fetchCall,
  fetchCallContactById,
  fetchCallContacts,
  fetchTranscript,
  getCallStatusLabel,
  hydrateCallRequest,
  parseIncomingInvite,
  resolveIncomingCallContact,
  startCallRequest,
  updateCallModeRequest,
} from "../api/call";

const TERMINAL_CALL_STATES: CallLifecycleState[] = [
  "declined",
  "canceled",
  "timeout",
  "ended",
  "failed",
];

async function getCurrentUser() {
  return getStoredUser<AuthUser>();
}

function resolveMode(kind?: string, fallback: CallMode = "audio"): CallMode {
  return kind === "video" ? "video" : kind === "audio" ? "audio" : fallback;
}

function resolveStartedAtMs(
  startedAt?: string | null,
  fallback?: number
): number {
  if (!startedAt) return fallback ?? Date.now();
  const parsed = new Date(startedAt).getTime();
  return Number.isFinite(parsed) ? parsed : fallback ?? Date.now();
}

export const callService = {
  async getSummary() {
    const contacts = await fetchCallContacts("").catch(() => [] as CallContact[]);
    const activeCall = activeCallService.get();

    return {
      todayCalls: contacts.length,
      missedCalls: 0,
      totalDurationLabel: activeCall && !activeCall.ended ? "Live now" : "0m",
      pendingCallsText:
        activeCall && !activeCall.ended
          ? `${activeCall.doctor.name} ${
              activeCall.callState === "ringing"
                ? "is being called"
                : "is on the line"
            }`
          : contacts.length > 0
            ? `${contacts.length} care team contact${
                contacts.length > 1 ? "s" : ""
              } available`
            : "No callable contacts yet",
    };
  },

  getContacts: fetchCallContacts,
  getContactById: fetchCallContactById,
  resolveIncomingContact: resolveIncomingCallContact,
  getCall: fetchCall,
  getTranscript: fetchTranscript,
  parseIncomingInvite,
  getCallStatusLabel,

  async startCall(payload: StartCallPayload) {
    const data = await startCallRequest(payload);
    const currentUser = await getCurrentUser();
    const session = buildSession(data, payload.contact, currentUser, payload.mode);
    activeCallService.set(session);
    return session;
  },

  async acceptCall(callId: number, contact: CallContact) {
    const data = await acceptCallRequest(callId);
    const currentUser = await getCurrentUser();
    const session = buildSession(data, contact, currentUser, data.kind);
    activeCallService.set(session);
    return session;
  },

  async hydrateCall(
    callId: number,
    contact: CallContact,
    preferredMode?: CallMode
  ) {
    const data = await hydrateCallRequest(callId);
    const currentUser = await getCurrentUser();
    const session = buildSession(data, contact, currentUser, preferredMode);
    activeCallService.set(session);
    return session;
  },

  async muteCall(_callId: number) {
    const current = activeCallService.get();
    if (!current) return null;

    return activeCallService.patch({
      muted: !current.muted,
    });
  },

  async stopCall(_callId: number) {
    const current = activeCallService.get();
    if (!current) return null;

    return activeCallService.patch({
      transcribing: !current.transcribing,
    });
  },

  async endCall(callId: number) {
    const data = await endCallRequest(callId);

    return activeCallService.patch({
      callState: data.state,
      ended: TERMINAL_CALL_STATES.includes(data.state),
      consultationStatus: getCallStatusLabel(data.state),
    });
  },

  async cancelCall(callId: number) {
    await cancelCallRequest(callId);

    return activeCallService.patch({
      callState: "canceled",
      ended: true,
      consultationStatus: getCallStatusLabel("canceled"),
    });
  },

  async declineCall(callId: number) {
    await declineCallRequest(callId);

    return activeCallService.patch({
      callState: "declined",
      ended: true,
      consultationStatus: getCallStatusLabel("declined"),
    });
  },

  async updateMode(callId: number, kind: CallMode) {
    const data = await updateCallModeRequest(callId, kind);
    const current = activeCallService.get();
    if (!current) return null;

    return activeCallService.patch({
      mode: resolveMode(data.kind, kind),
      callState: data.state,
      consultationStatus: getCallStatusLabel(data.state),
      startedAtMs: resolveStartedAtMs(data.started_at, current.startedAtMs),
    });
  },

  applyRealtimeCallState(event: {
    type: string;
    callId: number;
    state?: CallSession["callState"];
    kind?: CallMode;
    startedAt?: string;
  }) {
    const current = activeCallService.get();
    if (!current || current.callId !== event.callId) return current;

    const resolvedState =
      event.state ||
      (event.type === "call.accepted"
        ? "active"
        : event.type === "call.declined"
          ? "declined"
          : event.type === "call.canceled"
            ? "canceled"
            : event.type === "call.timeout"
              ? "timeout"
              : event.type === "call.ended"
                ? "ended"
                : current.callState);

    return activeCallService.patch({
      callState: resolvedState,
      mode: event.kind ?? current.mode,
      consultationStatus: getCallStatusLabel(resolvedState),
      ended: TERMINAL_CALL_STATES.includes(resolvedState),
      startedAtMs: resolveStartedAtMs(event.startedAt, current.startedAtMs),
    });
  },
};