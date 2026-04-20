import type { CallContact, IncomingCallInvite } from "../../types/call";

export type IncomingCallPhase =
  | "idle"
  | "ringing"
  | "accepting"
  | "declining";

export type IncomingCallState = {
  invite: IncomingCallInvite | null;
  contact: CallContact | null;
  phase: IncomingCallPhase;
  receivedAtMs?: number;
};

type Listener = (next: IncomingCallState) => void;

class IncomingCallService {
  private state: IncomingCallState = {
    invite: null,
    contact: null,
    phase: "idle",
    receivedAtMs: undefined,
  };

  private listeners = new Set<Listener>();

  getState(): IncomingCallState {
    return this.state;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.state);

    return () => {
      this.listeners.delete(listener);
    };
  }

  show(invite: IncomingCallInvite, contact: CallContact | null) {
    const currentCallId = this.state.invite?.callId;
    const sameCall = currentCallId && currentCallId === invite.callId;

    this.state = {
      invite,
      contact: contact ?? this.state.contact,
      phase: "ringing",
      receivedAtMs: sameCall ? this.state.receivedAtMs : Date.now(),
    };

    this.emit();
  }

  patchContact(callId: number, contact: CallContact) {
    if (this.state.invite?.callId !== callId) return;

    this.state = {
      ...this.state,
      contact,
    };

    this.emit();
  }

  setPhase(phase: IncomingCallPhase) {
    this.state = {
      ...this.state,
      phase,
    };

    this.emit();
  }

  clear(callId?: number) {
    if (callId && this.state.invite?.callId !== callId) {
      return;
    }

    this.state = {
      invite: null,
      contact: null,
      phase: "idle",
      receivedAtMs: undefined,
    };

    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

export const incomingCallService = new IncomingCallService();