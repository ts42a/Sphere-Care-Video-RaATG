jest.mock("../src/services/sessionService", () => ({
  getAccessToken: jest.fn(),
}));

import { wsClient } from "../src/services/wsClient";
import { getAccessToken } from "../src/services/sessionService";

const mockGetAccessToken = getAccessToken as jest.MockedFunction<typeof getAccessToken>;
const ws = wsClient as any;

beforeEach(() => {
  jest.clearAllMocks();
  ws.listeners = new Map();
  ws.openListeners = new Set();
  ws.socket = null;
  ws.connected = false;
  ws.connectPromise = null;
  ws.manualClose = false;
  ws.reconnectAttempts = 0;
  if (ws.reconnectTimer) {
    clearTimeout(ws.reconnectTimer);
    ws.reconnectTimer = null;
  }
});

test("test_wsClient_connect_builds_correct_url", async () => {
  process.env.EXPO_PUBLIC_WS_BASE_URL = "http://localhost:8000";
  mockGetAccessToken.mockResolvedValue("abc123");

  const MockWS = jest.fn().mockImplementation(function (this: any, url: string) {
    this.url = url;
    this.readyState = 1;
    this.close = jest.fn();
    setTimeout(() => {
      if (this.onopen) this.onopen({} as Event);
    }, 0);
  });
  (MockWS as any).OPEN = 1;
  global.WebSocket = MockWS as unknown as typeof WebSocket;

  await wsClient.connect();

  expect(MockWS).toHaveBeenCalledWith(
    "ws://localhost:8000/ws?token=abc123"
  );
});

test("test_wsClient_subscribe_returns_unsubscribe_fn", () => {
  const listener = jest.fn();
  const unsub = wsClient.subscribe("some.event", listener);

  expect(typeof unsub).toBe("function");

  unsub();
  ws.emit("some.event", { x: 1 });
  expect(listener).not.toHaveBeenCalled();
});

test("test_wsClient_emit_routes_to_correct_listener", () => {
  const correctListener = jest.fn();
  const otherListener = jest.fn();

  wsClient.subscribe("call.invite", correctListener);
  wsClient.subscribe("call.ended", otherListener);

  ws.emit("call.invite", { callId: 7 });

  expect(correctListener).toHaveBeenCalledWith({ callId: 7 });
  expect(otherListener).not.toHaveBeenCalled();
});

test("test_wsClient_wildcard_receives_all_events", () => {
  const wildcardListener = jest.fn();
  wsClient.subscribe("*", wildcardListener);

  ws.emit("*", { type: "call.canceled", callId: 5 });

  expect(wildcardListener).toHaveBeenCalledWith({ type: "call.canceled", callId: 5 });
});
