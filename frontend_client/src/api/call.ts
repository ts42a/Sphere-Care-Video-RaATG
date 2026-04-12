import { request } from "./client";
import type {
  CallContact,
  CallControlState,
  CallMode,
  CallSession,
  CallSummary,
  StartCallPayload,
  TranscriptItem,
} from "../types/call";
import { mockCallContacts, mockCallSummary } from "../mock/callData";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type BackendCallParticipant = {
  name: string;
  role: string;
  initials: string;
};

type BackendCurrentCallResponse = {
  call_id: number;
  duration: string;
  doctor: BackendCallParticipant;
  patient: BackendCallParticipant;
  consultation_status: string;
  transcribing: boolean;
  mode?: CallMode;
  transcript: TranscriptItem[];
};

type BackendCallControlResponse = {
  message: string;
  call_id: number;
  muted?: boolean;
  transcribing?: boolean;
  ended?: boolean;
};

function mapSession(data: BackendCurrentCallResponse, mode: CallMode): CallSession {
  return {
    callId: data.call_id,
    duration: data.duration,
    doctor: data.doctor,
    patient: data.patient,
    consultationStatus: data.consultation_status,
    transcribing: data.transcribing,
    muted: false,
    ended: false,
    mode: data.mode ?? mode,
    startedAtMs: Date.now(),
  };
}

export async function fetchCallSummary(): Promise<CallSummary> {
  await wait(120);
  return mockCallSummary;
}

export async function fetchCallContacts(search = ""): Promise<CallContact[]> {
  await wait(120);

  const keyword = search.trim().toLowerCase();

  if (!keyword) return mockCallContacts;

  return mockCallContacts.filter((item) =>
    `${item.name} ${item.specialty} ${item.id}`.toLowerCase().includes(keyword)
  );
}

export async function fetchCallContactById(contactId: string): Promise<CallContact> {
  await wait(100);

  const contact = mockCallContacts.find((item) => item.id === contactId);

  if (!contact) {
    throw new Error("Contact not found");
  }

  return contact;
}

export async function startCall(payload: StartCallPayload): Promise<CallSession> {
  const data = await request<BackendCurrentCallResponse>("/call/start", {
    method: "POST",
    body: {
      doctor_name: payload.doctorName,
      patient_name: payload.patientName,
      doctor_initials: payload.doctorInitials,
      patient_initials: payload.patientInitials,
      mode: payload.mode,
    },
  });

  return mapSession(data, payload.mode);
}

export async function fetchCurrentCall(): Promise<CallSession | null> {
  try {
    const data = await request<BackendCurrentCallResponse>("/call/current");
    return mapSession(data, data.mode ?? "audio");
  } catch {
    return null;
  }
}

export async function fetchTranscript(callId: number): Promise<TranscriptItem[]> {
  return request<TranscriptItem[]>(`/call/${callId}/transcript`);
}

export async function muteCall(callId: number): Promise<CallControlState> {
  const data = await request<BackendCallControlResponse>(`/call/${callId}/mute`, {
    method: "POST",
  });

  return {
    callId: data.call_id,
    message: data.message,
    muted: data.muted,
    transcribing: data.transcribing,
    ended: data.ended,
  };
}

export async function stopCall(callId: number): Promise<CallControlState> {
  const data = await request<BackendCallControlResponse>(`/call/${callId}/stop`, {
    method: "POST",
  });

  return {
    callId: data.call_id,
    message: data.message,
    muted: data.muted,
    transcribing: data.transcribing,
    ended: data.ended,
  };
}

export async function endCall(callId: number): Promise<CallControlState> {
  const data = await request<BackendCallControlResponse>(`/call/${callId}/end`, {
    method: "POST",
  });

  return {
    callId: data.call_id,
    message: data.message,
    muted: data.muted,
    transcribing: data.transcribing,
    ended: data.ended,
  };
}