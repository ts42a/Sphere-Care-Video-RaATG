import type { CallContact, CallSession } from "../types/call";

type ActiveCallListener = (session: CallSession | null) => void;

let activeCall: CallSession | null = null;
const listeners = new Set<ActiveCallListener>();

function emit() {
  listeners.forEach((listener) => listener(activeCall ? { ...activeCall } : null));
}

function matchesContact(session: CallSession | null, contact: CallContact | null) {
  if (!session || !contact) return false;
  if (contact.userId && session.remoteUserId) {
    return contact.userId === session.remoteUserId;
  }
  if (contact.conversationId && session.conversationId) {
    return contact.conversationId === session.conversationId;
  }
  return session.doctor.name === contact.name;
}

export const activeCallService = {
  get() {
    return activeCall ? { ...activeCall } : null;
  },

  getByCallId(callId?: number | null) {
    if (!callId || !activeCall) return null;
    return activeCall.callId === callId ? { ...activeCall } : null;
  },

  getForContact(contact: CallContact | null, callId?: number | null) {
    if (callId && activeCall?.callId === callId) {
      return { ...activeCall };
    }
    return matchesContact(activeCall, contact) ? { ...activeCall! } : null;
  },

  set(session: CallSession) {
    activeCall = { ...session };
    emit();
    return this.get();
  },

  patch(patch: Partial<CallSession>) {
    if (!activeCall) return null;

    activeCall = {
      ...activeCall,
      ...patch,
    };
    emit();
    return this.get();
  },

  subscribe(listener: ActiveCallListener) {
    listeners.add(listener);
    listener(activeCall ? { ...activeCall } : null);
    return () => {
      listeners.delete(listener);
    };
  },

  clear() {
    activeCall = null;
    emit();
  },
};