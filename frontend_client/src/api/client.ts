import { API_BASE_URL } from "../config/api";
import { getAccessToken } from "../services/sessionService";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string;
};

export async function request<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, token } = options;
  const authToken = token ?? (await getAccessToken()) ?? undefined;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;

    try {
      const errorJson = await response.json();

      if (typeof errorJson?.detail === "string") {
        errorMessage = errorJson.detail;
      } else if (typeof errorJson?.detail?.msg === "string") {
        errorMessage = errorJson.detail.msg;
      } else if (typeof errorJson?.message === "string") {
        errorMessage = errorJson.message;
      }
    } catch {
    }

    throw new Error(errorMessage);
  }

  return response.json() as Promise<T>;
}