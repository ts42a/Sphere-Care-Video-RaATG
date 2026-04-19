import type { CallContact, IncomingCallInvite } from "../../types/call";

export type IncomingCallState = {
  invite: IncomingCallInvite | null;
  contact: CallContact | null;
};

type Listener = (next: IncomingCallState) => void;

class IncomingCallService {
  private state: IncomingCallState = {
    invite: null,
    contact: null,
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
    this.state = {
      invite,
      contact,
    };
    this.emit();
  }

  clear() {
    this.state = {
      invite: null,
      contact: null,
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