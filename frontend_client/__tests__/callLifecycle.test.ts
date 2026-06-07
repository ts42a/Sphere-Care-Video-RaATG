jest.mock("../src/services/activeCallService", () => ({
  activeCallService: {
    get: jest.fn(),
    set: jest.fn(),
    patch: jest.fn((patch: object) => patch),
  },
}));

jest.mock("../src/services/sessionService", () => ({
  getStoredUser: jest.fn().mockResolvedValue(null),
  getAccessToken: jest.fn(),
  saveSession: jest.fn(),
  clearSession: jest.fn(),
}));

jest.mock("../src/api/call", () => ({
  acceptCallRequest: jest.fn(),
  buildSession: jest.fn(),
  cancelCallRequest: jest.fn(),
  declineCallRequest: jest.fn(),
  endCallRequest: jest.fn(),
  fetchCall: jest.fn(),
  fetchCallContactById: jest.fn(),
  fetchCallContacts: jest.fn(),
  fetchCallHistory: jest.fn(),
  fetchCallSummary: jest.fn(),
  fetchTranscript: jest.fn(),
  getCallStatusLabel: jest.fn((s: string) => s),
  hydrateCallRequest: jest.fn(),
  parseIncomingInvite: jest.fn(),
  resolveIncomingCallContact: jest.fn(),
  startCallRequest: jest.fn(),
  updateCallModeRequest: jest.fn(),
}));

import { callService } from "../src/services/callService";
import { activeCallService } from "../src/services/activeCallService";
import type { CallLifecycleState } from "../src/types/call";

const mockActiveCallService = activeCallService as jest.Mocked<typeof activeCallService>;

const TERMINAL_STATES: CallLifecycleState[] = [
  "declined",
  "canceled",
  "timeout",
  "ended",
  "failed",
];
const NON_TERMINAL_STATES: CallLifecycleState[] = ["ringing", "active"];

beforeEach(() => {
  jest.clearAllMocks();
  mockActiveCallService.get.mockReturnValue({
    callId: 1,
    mode: "audio",
    startedAtMs: Date.now(),
    callState: "active",
    consultationStatus: "Active",
    ended: false,
    muted: false,
    transcribing: false,
    doctor: { userId: 2, name: "Dr. Smith", role: "doctor", initials: "DS" },
    patient: { userId: 1, name: "Patient One", role: "client", initials: "PO" },
  } as any);
  mockActiveCallService.patch.mockImplementation((patch: any) => patch);
});

test("test_call_lifecycle_terminal_states", () => {
  for (const state of TERMINAL_STATES) {
    const result = callService.applyRealtimeCallState({
      type: `call.${state}`,
      callId: 1,
      state,
    });
    expect((result as any)?.ended).toBe(true);
  }

  for (const state of NON_TERMINAL_STATES) {
    const result = callService.applyRealtimeCallState({
      type: `call.${state}`,
      callId: 1,
      state,
    });
    expect((result as any)?.ended).toBe(false);
  }
});
