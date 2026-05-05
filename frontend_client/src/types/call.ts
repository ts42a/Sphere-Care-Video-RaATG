export type CallMode = "audio" | "video";
export type CallLifecycleState =
  | "ringing"
  | "active"
  | "declined"
  | "canceled"
  | "timeout"
  | "ended"
  | "failed";

export type TranscriptRole = "doctor" | "patient" | "ai";

export type TranscriptItem = {
  id: number;
  speaker: string;
  role: TranscriptRole;
  content: string;
  created_at: string;
};

export type CallContact = {
  id: string;
  conversationId?: string;
  userId?: number;
  participantType?: string;
  initials: string;
  name: string;
  specialty: string;
  role?: string;
  lastSeen: string;
  lastSeenAt?: string;
  online: boolean;
  avatarColor: string;
};

export type CallSummary = {
  todayCalls: number;
  missedCalls: number;
  totalDurationLabel: string;
  pendingCallsText: string;
};

export type CallHistoryItem = {
  callId: number;
  state: CallLifecycleState;
  kind: CallMode;
  direction: "incoming" | "outgoing";
  remoteUserId: number;
  remoteName: string;
  remoteRole?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
  durationSeconds: number;
  durationLabel: string;
};

export type CallParticipant = {
  userId?: number;
  name: string;
  role: string;
  initials: string;
};

export type CallJoinPayload = {
  callId: number;
  roomId: string;
  livekitUrl?: string | null;
  accessToken?: string | null;
  expiresAt: string;
  state: CallLifecycleState;
};

export type CallSession = {
  callId: number;
  mode: CallMode;
  callState: CallLifecycleState;
  consultationStatus: string;
  doctor: CallParticipant;
  patient: CallParticipant;
  remoteUserId?: number;
  conversationId?: string;
  livekitUrl?: string | null;
  joinPayload?: CallJoinPayload | null;
  inviteExpiresAt?: string;
  muted: boolean;
  transcribing: boolean;
  ended: boolean;
  startedAtMs: number;
};

export type StartCallPayload = {
  mode: CallMode;
  contact: CallContact;
};

export type CallControlState = {
  callId: number;
  message: string;
  muted?: boolean;
  transcribing?: boolean;
  ended?: boolean;
};

export type IncomingCallInvite = {
  callId: number;
  kind: "audio" | "video";
  state?: CallLifecycleState;
  callerUserId?: number | null;
  callerParticipantType?: string | null;
  callerName?: string;
  callerRole?: string | null;
  timestamp?: string;
  roomId?: string;
  expiresAt?: string | null;
};

export type BackendCallJoinPayload = {
  call_id: number;
  room_id: string;
  livekit_url?: string | null;
  access_token?: string | null;
  expires_at: string;
  state: CallLifecycleState;
};

export type BackendCallResponse = {
  call_id: number;
  room_id: string;
  state: CallLifecycleState;
  kind: CallMode;
  caller_user_id: number;
  callee_user_id: number;
  invite_expires_at: string;
  started_at?: string | null;
  ended_at?: string | null;
  livekit_url?: string | null;
  join_payload?: BackendCallJoinPayload | null;
};