const rawWsBaseUrl = process.env.EXPO_PUBLIC_WS_BASE_URL?.trim();

function normalizeWsBaseUrl(value?: string) {
  const baseUrl =
    value && value.length > 0 ? value : "ws://localhost:8000/ws";

  return baseUrl.replace(/\/+$/, "");
}

export const WS_BASE_URL = normalizeWsBaseUrl(rawWsBaseUrl);