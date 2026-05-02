import { request } from "./client";
import type { AuthUser } from "../types/auth";
import type {
  BackendCallResponse,
  CallContact,
  CallHistoryItem,
  CallJoinPayload,
  CallLifecycleState,
  CallMode,
  CallSession,
  CallSummary,
  IncomingCallInvite,
  StartCallPayload,
  TranscriptItem,
} from "../types/call";
import type { ConversationItem } from "../types/message";

type BackendCallSummaryResponse = {
  today_calls: number;
  missed_calls: number;
  total_duration_minutes: number;
  total_duration_label: string;
  pending_calls_text: string;
};

type BackendCallHistoryItem = {
  call_id: number;
  state: CallLifecycleState;
  kind: CallMode;
  direction: "incoming" | "outgoing";
  remote_user_id: number;
  remote_name: string;
  remote_role?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  created_at: string;
  duration_seconds: number;
  duration_label: string;
};

function consultationStatusForState(
  state?: CallLifecycleState
): CallSession["consultationStatus"] {
  switch (state) {
    case "ringing":
      return "Calling";
    case "active":
      return "In progress";
    case "declined":
      return "Declined";
    case "canceled":
      return "Canceled";
    case "timeout":
      return "Missed";
    case "ended":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "Calling";
  }
}

function resolveCallMode(kind?: string, fallback: CallMode = "audio"): CallMode {
  return kind === "video" ? "video" : kind === "audio" ? "audio" : fallback;
}

function resolveJoinPayload(data: BackendCallResponse): CallJoinPayload | null {
  if (!data.join_payload) return null;

  return {
    callId: data.join_payload.call_id,
    roomId: data.join_payload.room_id,
    livekitUrl: data.join_payload.livekit_url ?? null,
    accessToken: data.join_payload.access_token ?? null,
    expiresAt: data.join_payload.expires_at,
    state: data.join_payload.state,
  };
}

function resolveStartedAtMs(
  startedAt?: string | null,
  fallback?: number
): number {
  if (!startedAt) return fallback ?? Date.now();
  const parsed = new Date(startedAt).getTime();
  return Number.isFinite(parsed) ? parsed : fallback ?? Date.now();
}

function initialsFromName(name: string) {
  return name
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const TERMINAL_CALL_STATES: CallLifecycleState[] = [
  "declined",
  "canceled",
  "timeout",
  "ended",
  "failed",
];

export function buildSession(
  data: BackendCallResponse,
  contact: CallContact,
  currentUser?: AuthUser | null,
  preferredMode?: CallMode
): CallSession {
  const localName = currentUser?.full_name || "Client user";
  const localRole = currentUser?.role || "client";
  const joinPayload = resolveJoinPayload(data);
  const mode = resolveCallMode(data.kind, preferredMode ?? "audio");
  const callState = (data.state ?? "ringing") as CallLifecycleState;
  const startedAtMs = resolveStartedAtMs(data.started_at);

  return {
    callId: data.call_id,
    mode,
    callState,
    consultationStatus: consultationStatusForState(callState),
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
    livekitUrl: data.livekit_url ?? joinPayload?.livekitUrl ?? null,
    joinPayload,
    inviteExpiresAt: data.invite_expires_at,
    muted: false,
    transcribing: true,
    ended: TERMINAL_CALL_STATES.includes(callState),
    startedAtMs,
  };
}

export async function fetchCallContacts(search = ""): Promise<CallContact[]> {
  const { fetchConversations } = await import("./message");
  const conversations: ConversationItem[] = await fetchConversations(search);

  return conversations.map((conversation) => ({
    id: conversation.contactId,
    conversationId: conversation.id,
    userId: conversation.targetUserId,
    initials: conversation.initials,
    name: conversation.name,
    specialty: conversation.role || "Care team",
    role: conversation.role || "Care team",
    lastSeen: conversation.time || "Recently active",
    lastSeenAt: conversation.lastMessageAt,
    online: conversation.online,
    avatarColor: conversation.avatarColor,
  }));
}

export async function fetchCallContactById(
  contactId: string
): Promise<CallContact | null> {
  const contacts = await fetchCallContacts("");
  return contacts.find((item) => String(item.id) === String(contactId)) ?? null;
}

export async function resolveIncomingCallContact(
  userId: number
): Promise<CallContact | null> {
  const contacts = await fetchCallContacts("");
  return contacts.find((item) => item.userId === userId) ?? null;
}

export async function fetchCallSummary(timeZone?: string): Promise<CallSummary> {
  const query = timeZone
    ? `?time_zone=${encodeURIComponent(timeZone)}`
    : "";

  const data = await request<BackendCallSummaryResponse>(`/calls/summary${query}`);

  return {
    todayCalls: data.today_calls,
    missedCalls: data.missed_calls,
    totalDurationLabel: data.total_duration_label,
    pendingCallsText: data.pending_calls_text,
  };
}

export async function fetchCallHistory(limit = 30): Promise<CallHistoryItem[]> {
  const data = await request<BackendCallHistoryItem[]>(`/calls/history?limit=${limit}`);

  return data.map((item) => ({
    callId: item.call_id,
    state: item.state,
    kind: item.kind,
    direction: item.direction,
    remoteUserId: item.remote_user_id,
    remoteName: item.remote_name,
    remoteRole: item.remote_role,
    startedAt: item.started_at,
    endedAt: item.ended_at,
    createdAt: item.created_at,
    durationSeconds: item.duration_seconds,
    durationLabel: item.duration_label,
  }));
}

export async function startCallRequest(
  payload: StartCallPayload
): Promise<BackendCallResponse> {
  if (!payload.contact.userId) {
    throw new Error("This conversation does not have a callable participant yet.");
  }

  return request<BackendCallResponse>("/calls", {
    method: "POST",
    body: {
      callee_user_id: payload.contact.userId,
      kind: payload.mode,
    },
  });
}

export async function acceptCallRequest(
  callId: number
): Promise<BackendCallResponse> {
  return request<BackendCallResponse>(`/calls/${callId}/accept`, {
    method: "POST",
  });
}

export async function hydrateCallRequest(
  callId: number
): Promise<BackendCallResponse> {
  return request<BackendCallResponse>(`/calls/${callId}`);
}

export async function fetchCall(callId: number): Promise<BackendCallResponse> {
  return request<BackendCallResponse>(`/calls/${callId}`);
}

export async function fetchTranscript(_callId: number): Promise<TranscriptItem[]> {
  return [];
}

export async function endCallRequest(
  callId: number
): Promise<BackendCallResponse> {
  return request<BackendCallResponse>(`/calls/${callId}/end`, {
    method: "POST",
  });
}

export async function cancelCallRequest(callId: number): Promise<void> {
  await request<BackendCallResponse>(`/calls/${callId}/cancel`, {
    method: "POST",
  });
}

export async function declineCallRequest(callId: number): Promise<void> {
  await request<BackendCallResponse>(`/calls/${callId}/decline`, {
    method: "POST",
  });
}

export async function updateCallModeRequest(
  callId: number,
  kind: CallMode
): Promise<BackendCallResponse> {
  return request<BackendCallResponse>(`/calls/${callId}/mode`, {
    method: "POST",
    body: { kind },
  });
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
    callerUserId:
      typeof payload.caller_user_id === "number"
        ? payload.caller_user_id
        : undefined,
    timestamp: payload.timestamp,
    roomId: payload.room_id,
    expiresAt: payload.expires_at,
  };
}

export function getCallStatusLabel(callState: CallSession["callState"]) {
  return consultationStatusForState(callState);
}