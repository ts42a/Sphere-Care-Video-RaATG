jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

jest.mock("@expo/vector-icons", () => ({
  Feather: "Feather",
}));

jest.mock("../src/services/sessionService", () => ({
  getAccessToken: jest.fn().mockResolvedValue(null),
}));

jest.mock("../src/services/wsClient", () => ({
  wsClient: {
    connect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockReturnValue(() => {}),
    disconnect: jest.fn(),
  },
}));

jest.mock("../src/services/callService", () => ({
  callService: {
    parseIncomingInvite: jest.fn(),
    acceptCall: jest.fn(),
    declineCall: jest.fn(),
    resolveIncomingContact: jest.fn(),
  },
}));

jest.mock("../src/services/miniCallService", () => ({
  miniCallService: { setState: jest.fn() },
}));

jest.mock("../src/theme/colors", () => ({
  colors: { surface: "#ffffff" },
}));

jest.mock("../src/services/call/incomingCallService", () => ({
  incomingCallService: {
    getState: jest.fn(),
    subscribe: jest.fn().mockReturnValue(() => {}),
    setPhase: jest.fn(),
    clear: jest.fn(),
  },
}));

import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";
import IncomingCallOverlay from "../src/components/call/IncomingCallOverlay";
import { incomingCallService } from "../src/services/call/incomingCallService";

const mockService = incomingCallService as jest.Mocked<typeof incomingCallService>;

beforeEach(() => {
  jest.clearAllMocks();
});

test("test_IncomingCallOverlay_renders_when_ringing", async () => {
  mockService.getState.mockReturnValue({
    invite: {
      callId: 42,
      kind: "video",
      callerName: "Dr. House",
      callerRole: "doctor",
    },
    contact: null,
    phase: "ringing",
    receivedAtMs: Date.now(),
  });

  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<IncomingCallOverlay />);
  });

  expect(tree.toJSON()).not.toBeNull();
});

test("test_IncomingCallOverlay_hidden_when_idle", async () => {
  mockService.getState.mockReturnValue({
    invite: null,
    contact: null,
    phase: "idle",
    receivedAtMs: undefined,
  });

  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<IncomingCallOverlay />);
  });

  expect(tree.toJSON()).toBeNull();
});
