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