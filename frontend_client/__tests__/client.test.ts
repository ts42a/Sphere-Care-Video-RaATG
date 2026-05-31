jest.mock("../src/services/sessionService", () => ({
  getAccessToken: jest.fn(),
}));

import { request } from "../src/api/client";
import { getAccessToken } from "../src/services/sessionService";

const mockGetAccessToken = getAccessToken as jest.MockedFunction<typeof getAccessToken>;

function makeFetchResponse(options: {
  ok: boolean;
  status?: number;
  body?: unknown;
}) {
  return Promise.resolve({
    ok: options.ok,
    status: options.status ?? (options.ok ? 200 : 400),
    json: () => Promise.resolve(options.body ?? {}),
  } as Response);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAccessToken.mockResolvedValue(null);
  global.fetch = jest.fn();
});

test("test_request_attaches_bearer_token", async () => {
  mockGetAccessToken.mockResolvedValue("my-token");
  (global.fetch as jest.Mock).mockReturnValue(
    makeFetchResponse({ ok: true, body: { ok: true } })
  );

  await request("/test-path");

  const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [
    string,
    RequestInit
  ];
  expect((init.headers as Record<string, string>)["Authorization"]).toBe(
    "Bearer my-token"
  );
});

test("test_request_throws_on_non_ok_response", async () => {
  (global.fetch as jest.Mock).mockReturnValue(
    makeFetchResponse({ ok: false, status: 500, body: {} })
  );

  await expect(request("/fail")).rejects.toThrow(
    "Request failed with status 500"
  );
});

test("test_request_parses_detail_error_message", async () => {
  (global.fetch as jest.Mock).mockReturnValue(
    makeFetchResponse({
      ok: false,
      status: 422,
      body: { detail: "Validation failed" },
    })
  );

  await expect(request("/validate")).rejects.toThrow("Validation failed");
});
