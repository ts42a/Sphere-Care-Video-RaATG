import type { CallSession } from "../types/call";

let activeCall: CallSession | null = null;

export const activeCallService = {
  get() {
    return activeCall;
  },

  set(session: CallSession) {
    activeCall = session;
    return activeCall;
  },

  patch(patch: Partial<CallSession>) {
    if (!activeCall) return null;

    activeCall = {
      ...activeCall,
      ...patch,
    };

    return activeCall;
  },

  clear() {
    activeCall = null;
  },
};