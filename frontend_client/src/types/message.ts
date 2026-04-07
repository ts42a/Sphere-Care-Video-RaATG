export type ConversationCategory = "team" | "resident" | "alerts" | "direct" | string;

export type ConversationItem = {
  id: string;
  name: string;
  role: string;
  category: ConversationCategory;
  preview: string;
  time: string;
  unread: number;
  online: boolean;
  initials: string;
  avatarColor: string;
  participantCount?: number;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  sender: "me" | "other";
  text: string;
  time: string;
  name?: string;
  senderRole?: string;
  createdAt?: string;
};

export type BackendConversation = {
  id: number;
  name: string;
  category: ConversationCategory;
  last_message?: string | null;
  last_message_at?: string | null;
  unread_count?: number;
  participant_count?: number;
};

export type BackendMessage = {
  id: number;
  conversation_id: number;
  sender_name: string;
  sender_role?: string | null;
  sender_user_id?: number | null;
  sender_participant_type?: string | null;
  content: string;
  message_type: string;
  is_self: boolean;
  created_at: string;
};