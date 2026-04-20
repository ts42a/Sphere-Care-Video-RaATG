import type { CallMode } from "../types/call";

export type MiniCallState = {
  active: boolean;
  minimized: boolean;
  mode?: CallMode;
  callId?: number;
  contactId?: string;
  contactName?: string;
  startedAtMs?: number;
  statusText?: string;
};

let state: MiniCallState = {
  active: false,
  minimized: false,
};

const listeners = new Set<(next: MiniCallState) => void>();

function emit() {
  listeners.forEach((listener) => listener(state));
}

export const miniCallService = {
  getState() {
    return state;
  },

  subscribe(listener: (next: MiniCallState) => void) {
    listeners.add(listener);
    listener(state);

    return () => {
      listeners.delete(listener);
    };
  },

  setState(patch: Partial<MiniCallState>) {
    state = {
      ...state,
      ...patch,
    };
    emit();
  },

  clear() {
    state = {
      active: false,
      minimized: false,
      mode: undefined,
      callId: undefined,
      contactId: undefined,
      contactName: undefined,
      startedAtMs: undefined,
      statusText: undefined,
    };
    emit();
  },
};