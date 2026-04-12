import type { RtcEngine } from "./rtcEngine";
import { mockRtcEngine } from "./mockRtcEngine";
import { providerRtcEngine } from "./providerRtcEngine";

/**
 * Use mock currently
 * Once we've decided on the RTC provider, simply change this to providerRtcEngine.
 */
export const rtcEngine: RtcEngine = mockRtcEngine;

// export const rtcEngine: RtcEngine = providerRtcEngine;