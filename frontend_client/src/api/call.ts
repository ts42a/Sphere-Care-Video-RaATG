import { request } from "./client";
import { fetchConversations } from "./message";
import type { AuthUser } from "../types/auth";
import type {
  BackendCallResponse,
  CallContact,
  CallJoinPayload,
  CallLifecycleState,
  CallMode,
  CallSession,
  IncomingCallInvite,
  StartCallPayload,
  TranscriptItem,
} from "../types/call";
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