import { Platform } from "react-native";
import { USE_LIVEKIT_RTC } from "../../config/rtc";
import type { RtcEngine } from "./rtcEngine";
import { mockRtcEngine } from "./mockRtcEngine";
import { providerRtcEngine } from "./providerRtcEngine";

export const rtcEngine: RtcEngine =
  USE_LIVEKIT_RTC && Platform.OS !== "web" ? providerRtcEngine : mockRtcEngine;