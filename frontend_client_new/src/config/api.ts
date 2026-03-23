const env = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

export const USE_MOCK_API = (process.env.EXPO_PUBLIC_USE_MOCK_API ?? "true") === "true";

export const API_BASE_URL = env && env.length > 0 ? env : "http://localhost:8000";
