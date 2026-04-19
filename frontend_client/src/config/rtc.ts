const rawProvider = (process.env.EXPO_PUBLIC_CALL_RTC_PROVIDER ?? "mock").trim().toLowerCase();

export const CALL_RTC_PROVIDER = rawProvider === "livekit" ? "livekit" : "mock";
export const USE_LIVEKIT_RTC = CALL_RTC_PROVIDER === "livekit";