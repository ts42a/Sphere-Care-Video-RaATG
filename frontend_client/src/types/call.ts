export type CallContact = {
  id: string;
  initials: string;
  name: string;
  specialty: string;
  role?: string;
  lastSeen: string;
  online: boolean;
  avatarColor: string;
};

export type CallSummary = {
  todayCalls: number;
  missedCalls: number;
  totalDurationLabel: string;
  pendingCallsText: string;
};

export type CallMode = "audio" | "video";

export type TranscriptRole = "doctor" | "patient" | "ai";

export type TranscriptItem = {
  id: number;
  speaker: string;
  role: TranscriptRole;
  content: string;
  created_at: string;
};

export type CallParticipant = {
  name: string;
  role: string;
  initials: string;
};

export type CallSession = {
  callId: number;
  duration: string;
  doctor: CallParticipant;
  patient: CallParticipant;
  consultationStatus: string;
  transcribing: boolean;
  muted: boolean;
  ended: boolean;
  mode: CallMode;
  startedAtMs: number;
};

export type StartCallPayload = {
  mode: CallMode;
  doctorName: string;
  doctorInitials: string;
  patientName: string;
  patientInitials: string;
};

export type CallControlState = {
  callId: number;
  message: string;
  muted?: boolean;
  transcribing?: boolean;
  ended?: boolean;
};