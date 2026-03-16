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

export type ConversationItem = {
  id: string;
  contactId: string;
  initials: string;
  name: string;
  role: string;
  preview: string;
  time: string;
  unread: number;
  online: boolean;
  avatarColor: string;
};

export type ChatMessage = {
  id: string;
  sender: "doctor" | "me";
  text: string;
  time: string;
  name?: string;
};

export const mockCallSummary: CallSummary = {
  todayCalls: 6,
  missedCalls: 2,
  totalDurationLabel: "1h 42m",
  pendingCallsText: "You have three pending calls today",
};

export const mockCallContacts: CallContact[] = [
  {
    id: "sarah-wilson",
    initials: "SW",
    name: "Dr. Sarah Wilson",
    specialty: "Cardiologist",
    role: "Cardiologist",
    lastSeen: "2 hours ago",
    online: true,
    avatarColor: "#3F7BF0",
  },
  {
    id: "jack-specs",
    initials: "JS",
    name: "Dr. Jack Specs",
    specialty: "General Practitioner",
    role: "General Practitioner",
    lastSeen: "1 hour ago",
    online: true,
    avatarColor: "#6558F5",
  },
  {
    id: "michael-chen",
    initials: "MC",
    name: "Dr. Michael Chen",
    specialty: "Internal Medicine",
    role: "Internal Medicine",
    lastSeen: "4 hours ago",
    online: false,
    avatarColor: "#17C2B8",
  },
  {
    id: "emily-rodriguez",
    initials: "ER",
    name: "Emily Rodriguez",
    specialty: "Nurse Supervisor",
    role: "Nurse Supervisor",
    lastSeen: "15 minutes ago",
    online: true,
    avatarColor: "#8D63FF",
  },
  {
    id: "family-johnson",
    initials: "FJ",
    name: "Family Johnson",
    specialty: "Family Contact",
    role: "Family Contact",
    lastSeen: "1 hour ago",
    online: false,
    avatarColor: "#27C27F",
  },
];

export const mockConversations: ConversationItem[] = [
  {
    id: "conv-sarah-wilson",
    contactId: "sarah-wilson",
    initials: "SW",
    name: "Dr. Sarah Wilson",
    role: "Cardiologist",
    preview: "Patient vitals look stable...",
    time: "2 min ago",
    unread: 2,
    online: true,
    avatarColor: "#3F7BF0",
  },
  {
    id: "conv-emily-rodriguez",
    contactId: "emily-rodriguez",
    initials: "ER",
    name: "Emily Rodriguez",
    role: "Nurse Supervisor",
    preview: "Thanks for the update on room 204...",
    time: "15 min ago",
    unread: 0,
    online: true,
    avatarColor: "#8D63FF",
  },
  {
    id: "conv-family-johnson",
    contactId: "family-johnson",
    initials: "FJ",
    name: "Family Johnson",
    role: "Family Contact",
    preview: "We will be visiting tomorrow morning...",
    time: "1 h ago",
    unread: 0,
    online: false,
    avatarColor: "#27C27F",
  },
  {
    id: "conv-michael-chen",
    contactId: "michael-chen",
    initials: "MC",
    name: "Dr. Michael Chen",
    role: "Internal Medicine",
    preview: "Lab results are ready for review...",
    time: "2 h ago",
    unread: 1,
    online: false,
    avatarColor: "#17C2B8",
  },
];

export const mockChatMessages: Record<string, ChatMessage[]> = {
  "sarah-wilson": [
    {
      id: "msg-1",
      sender: "doctor",
      text: "Good morning! How is Mrs. Anderson doing today?",
      time: "9:23 AM",
      name: "Dr. Sarah Wilson",
    },
    {
      id: "msg-2",
      sender: "me",
      text: "Morning! She had a good night. Vitals are stable.",
      time: "9:25 AM",
    },
    {
      id: "msg-3",
      sender: "doctor",
      text: "Have you administered her morning medication?",
      time: "9:26 AM",
      name: "Dr. Sarah Wilson",
    },
    {
      id: "msg-4",
      sender: "me",
      text: "Yes, completed at 8:00 AM. BP 128/82, temp 98.4°F.",
      time: "9:28 AM",
    },
  ],
  "jack-specs": [
    {
      id: "msg-5",
      sender: "doctor",
      text: "Please monitor blood pressure again this afternoon.",
      time: "10:05 AM",
      name: "Dr. Jack Specs",
    },
    {
      id: "msg-6",
      sender: "me",
      text: "Understood. I will update the chart after measurement.",
      time: "10:08 AM",
    },
  ],
};

export const mockTranscriptLines: Record<string, string[]> = {
  "sarah-wilson": [
    "It's more of a dull ache, especially after I've been sitting for long periods.",
    "I understand. Can you describe the intensity on a scale of 1 to 10?",
    "I'd say it's around a 6 most days, but it can spike to an 8 when I'm stressed.",
  ],
  "jack-specs": [
    "Let us review the blood pressure trend from this week.",
    "The readings look improved compared with last Tuesday.",
    "Please continue monitoring after lunch and before sleep.",
  ],
};