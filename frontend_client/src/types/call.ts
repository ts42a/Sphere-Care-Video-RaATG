export type CallContact = {
  id: string;
  initials: string;
  name: string;
  specialty: string;
  role?: string;
  lastSeen: string;
  online: boolean;
  avatarColor: string;
};

export type CallSummary = {
  todayCalls: number;
  missedCalls: number;
  totalDurationLabel: string;
  pendingCallsText: string;
};