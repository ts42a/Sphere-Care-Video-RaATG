const env = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

export const USE_MOCK_API = (process.env.EXPO_PUBLIC_USE_MOCK_API ?? "false") === "true";

function normalizeApiBaseUrl(rawBase?: string) {
	const base = rawBase && rawBase.length > 0 ? rawBase : "http://localhost:8000";
	const trimmed = base.replace(/\/+$/, "");

	// Keep compatibility if the env var already includes the API prefix.
	if (trimmed.endsWith("/api/v1")) {
		return trimmed;
	}

	return `${trimmed}/api/v1`;
}

export const API_BASE_URL = normalizeApiBaseUrl(env);
