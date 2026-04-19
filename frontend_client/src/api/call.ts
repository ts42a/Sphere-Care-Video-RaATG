import { request } from "./client";
import { getStoredUser } from "../services/sessionService";
import { fetchConversations } from "./message";
import type { AuthUser } from "../types/auth";
import type {
  BackendCallResponse,
  CallContact,
  CallControlState,
  CallJoinPayload,
  CallLifecycleState,
  CallMode,
  CallSession,
  CallSummary,
  IncomingCallInvite,
  StartCallPayload,
  TranscriptItem,
} from "../types/call";
import { activeCallService } from "../services/activeCallService";

const contactCache = new Map<string, CallContact>();
const TERMINAL_CALL_STATES: CallLifecycleState[] = ["declined", "canceled", "timeout", "ended", "failed"];

function initialsFromName(name: string) {
  return (name || "?")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

async function getCurrentUser() {
  return getStoredUser<AuthUser>();
}

function buildJoinPayload(data?: BackendCallResponse["join_payload"] | null): CallJoinPayload | null {
  if (!data) return null;
  return {
    callId: data.call_id,
    roomId: data.room_id,
    livekitUrl: data.livekit_url,
    accessToken: data.access_token,
    expiresAt: data.expires_at,
    state: data.state,
  };
}

function consultationStatusForState(state: string) {
  switch (state) {
    case "ringing":
      return "Ringing care team";
    case "active":
      return "Connected";
    case "declined":
      return "Call declined";
    case "canceled":
      return "Call canceled";
    case "timeout":
      return "No answer";
    case "ended":
      return "Call ended";
    case "failed":
      return "Call failed";
    default:
      return "Connecting";
  }
}

function resolveSessionMode(data: BackendCallResponse, preferredMode?: CallMode) {
  if (data.kind === "video" || data.kind === "audio") {
    return data.kind;
  }
  return preferredMode ?? "audio";
}

function resolveStartedAtMs(data: BackendCallResponse) {
  if (!data.started_at) return Date.now();
  const parsed = new Date(data.started_at).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function buildSession(
  data: BackendCallResponse,
  contact: CallContact,
  currentUser: AuthUser | null,
  preferredMode?: CallMode
): CallSession {
  const localName = currentUser?.full_name || "Client user";
  const localRole = currentUser?.role || "client";
  const joinPayload = buildJoinPayload(data.join_payload);
  const mode = resolveSessionMode(data, preferredMode);

  return {
    callId: data.call_id,
    mode,
    callState: data.state,
    consultationStatus: consultationStatusForState(data.state),
    doctor: {
      userId: contact.userId,
      name: contact.name,
      role: contact.role || contact.specialty || "Care team",
      initials: contact.initials,
    },
    patient: {
      userId: currentUser?.id,
      name: localName,
      role: localRole,
      initials: initialsFromName(localName),
    },
    remoteUserId: contact.userId,
    conversationId: contact.conversationId,
    livekitUrl: data.livekit_url,
    joinPayload,
    inviteExpiresAt: data.invite_expires_at,
    muted: false,
    transcribing: true,
    ended: TERMINAL_CALL_STATES.includes(data.state),
    startedAtMs: resolveStartedAtMs(data),
  };
}

export async function fetchCallContacts(search = ""): Promise<CallContact[]> {
  const conversations = await fetchConversations(search);

  return conversations
    .filter((conversation) => Boolean(conversation.targetUserId))
    .map((conversation) => {
      const contact: CallContact = {
        id: conversation.id,
        conversationId: conversation.id,
        userId: conversation.targetUserId,
        initials: conversation.initials,
        name: conversation.name,
        specialty: conversation.role,
        role: conversation.role,
        lastSeen: conversation.time || "Recently active",
        online: conversation.online,
        avatarColor: conversation.avatarColor,
      };

      contactCache.set(contact.id, contact);
      if (contact.userId) {
        contactCache.set(`user-${contact.userId}`, contact);
      }
      return contact;
    });
}

export async function fetchCallContactById(contactId: string): Promise<CallContact> {
  const normalizedId = String(contactId);
  const cached = contactCache.get(normalizedId);
  if (cached) return cached;

  const contacts = await fetchCallContacts("");
  const matched = contacts.find((item) => item.id === normalizedId);
  if (matched) return matched;

  if (normalizedId.startsWith("user-")) {
    const userId = Number(normalizedId.replace("user-", ""));
    const fallback: CallContact = {
      id: normalizedId,
      userId: Number.isFinite(userId) ? userId : undefined,
      initials: "CT",
      name: `Care team #${Number.isFinite(userId) ? userId : ""}`.trim(),
      specialty: "Care team",
      role: "Care team",
      lastSeen: "Recently active",
      online: false,
      avatarColor: "#3F7BF0",
    };
    contactCache.set(normalizedId, fallback);
    return fallback;
  }

  throw new Error("Contact not found");
}

export async function resolveIncomingCallContact(callerUserId?: number | null): Promise<CallContact> {
  if (!callerUserId) {
    return {
      id: `user-unknown-${Date.now()}`,
      initials: "CT",
      name: "Care team",
      specialty: "Care team",
      role: "Care team",
      lastSeen: "Calling now",
      online: true,
      avatarColor: "#3F7BF0",
    };
  }

  const cached = contactCache.get(`user-${callerUserId}`);
  if (cached) return cached;

  const contacts = await fetchCallContacts("");
  const matched = contacts.find((contact) => contact.userId === callerUserId);
  if (matched) return matched;

  const fallback: CallContact = {
    id: `user-${callerUserId}`,
    userId: callerUserId,
    initials: "CT",
    name: `Care team #${callerUserId}`,
    specialty: "Care team",
    role: "Care team",
    lastSeen: "Calling now",
    online: true,
    avatarColor: "#3F7BF0",
  };
  contactCache.set(fallback.id, fallback);
  return fallback;
}

export async function startCall(payload: StartCallPayload): Promise<CallSession> {
  if (!payload.contact.userId) {
    throw new Error("This conversation does not have a callable participant yet.");
  }

  const data = await request<BackendCallResponse>("/calls", {
    method: "POST",
    body: {
      callee_user_id: payload.contact.userId,
      kind: payload.mode,
    },
  });

  const currentUser = await getCurrentUser();
  const session = buildSession(data, payload.contact, currentUser, payload.mode);
  activeCallService.set(session);
  return session;
}

export async function acceptCall(callId: number, contact: CallContact): Promise<CallSession> {
  const data = await request<BackendCallResponse>(`/calls/${callId}/accept`, {
    method: "POST",
  });
  const currentUser = await getCurrentUser();
  const session = buildSession(data, contact, currentUser, data.kind);
  activeCallService.set(session);
  return session;
}

export async function hydrateCall(callId: number, contact: CallContact, preferredMode?: CallMode): Promise<CallSession> {
  const data = await request<BackendCallResponse>(`/calls/${callId}`);
  const currentUser = await getCurrentUser();
  const session = buildSession(data, contact, currentUser, preferredMode);
  activeCallService.set(session);
  return session;
}

export async function fetchCall(callId: number): Promise<BackendCallResponse> {
  return request<BackendCallResponse>(`/calls/${callId}`);
}

export async function fetchCallSummary(): Promise<CallSummary> {
  const contacts = await fetchCallContacts("").catch(() => [] as CallContact[]);
  const activeCall = activeCallService.get();
  return {
    todayCalls: contacts.length,
    missedCalls: 0,
    totalDurationLabel: activeCall && !activeCall.ended ? "Live now" : "0m",
    pendingCallsText: activeCall && !activeCall.ended
      ? `${activeCall.doctor.name} ${activeCall.callState === "ringing" ? "is being called" : "is on the line"}`
      : contacts.length > 0
      ? `${contacts.length} care team contact${contacts.length > 1 ? "s" : ""} available`
      : "No callable contacts yet",
  };
}

export async function fetchTranscript(_callId: number): Promise<TranscriptItem[]> {
  return [];
}

export async function muteCall(callId: number): Promise<CallControlState> {
  const current = activeCallService.get();
  const nextMuted = !(current?.muted ?? false);
  activeCallService.patch({ muted: nextMuted });
  return {
    callId,
    message: nextMuted ? "Muted" : "Unmuted",
    muted: nextMuted,
  };
}

export async function stopCall(callId: number): Promise<CallControlState> {
  const current = activeCallService.get();
  const nextTranscribing = !(current?.transcribing ?? true);
  activeCallService.patch({ transcribing: nextTranscribing });
  return {
    callId,
    message: nextTranscribing ? "AI transcript resumed" : "AI transcript paused",
    transcribing: nextTranscribing,
  };
}

export async function endCall(callId: number): Promise<CallControlState> {
  const data = await request<BackendCallResponse>(`/calls/${callId}/end`, {
    method: "POST",
  });

  activeCallService.patch({
    callState: data.state,
    ended: TERMINAL_CALL_STATES.includes(data.state),
    consultationStatus: consultationStatusForState(data.state),
  });

  return {
    callId,
    message: data.state === "ended" ? "Call ended" : "Call closed",
    ended: TERMINAL_CALL_STATES.includes(data.state),
  };
}

export async function cancelCall(callId: number): Promise<void> {
  await request<BackendCallResponse>(`/calls/${callId}/cancel`, {
    method: "POST",
  });
}

export async function declineCall(callId: number): Promise<void> {
  await request<BackendCallResponse>(`/calls/${callId}/decline`, {
    method: "POST",
  });
}

export async function updateCallMode(callId: number, kind: CallMode): Promise<CallSession | null> {
  const data = await request<BackendCallResponse>(`/calls/${callId}/mode`, {
    method: "POST",
    body: { kind },
  });

  const current = activeCallService.get();
  if (!current) return null;

  const startedAtMs = data.started_at ? new Date(data.started_at).getTime() : current.startedAtMs;
  const next = activeCallService.patch({
    mode: resolveSessionMode(data, kind),
    callState: data.state,
    consultationStatus: consultationStatusForState(data.state),
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : current.startedAtMs,
  });

  return next;
}

export function applyRealtimeCallState(event: {
  type: string;
  callId: number;
  state?: CallSession["callState"];
  kind?: CallMode;
  startedAt?: string;
}) {
  const current = activeCallService.get();
  if (!current || current.callId != event.callId) return current;

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

  const nextStartedAtMs = event.startedAt
    ? new Date(event.startedAt).getTime()
    : current.startedAtMs;

  const next = activeCallService.patch({
    callState: resolvedState,
    mode: event.kind ?? current.mode,
    consultationStatus: consultationStatusForState(resolvedState),
    ended: TERMINAL_CALL_STATES.includes(resolvedState),
    startedAtMs: Number.isFinite(nextStartedAtMs) ? nextStartedAtMs : current.startedAtMs,
  });

  return next;
}

export function parseIncomingInvite(payload: any): IncomingCallInvite | null {
  if (!payload || typeof payload !== "object") return null;
  const callId = Number(payload.call_id ?? payload.callId);
  if (!Number.isFinite(callId)) return null;

  const kind = payload.kind === "video" ? "video" : "audio";

  return {
    callId,
    state: payload.state ?? "ringing",
    kind,
    callerUserId: typeof payload.caller_user_id === "number" ? payload.caller_user_id : undefined,
    timestamp: payload.timestamp,
    roomId: payload.room_id,
    expiresAt: payload.expires_at,
  };
}

export function getCallStatusLabel(callState: CallSession["callState"]) {
  return consultationStatusForState(callState);
}