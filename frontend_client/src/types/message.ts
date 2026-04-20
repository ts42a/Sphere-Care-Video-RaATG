export type ConversationCategory = "team" | "resident" | "alerts" | "direct" | string;

export type ConversationParticipant = {
  id: number;
  userId?: number;
  participantType: string;
  displayName: string;
  role?: string;
  lastReadAt?: string | null;
  joinedAt?: string | null;
};

export type ConversationItem = {
  id: string;
  contactId: string;
  name: string;
  role: string;
  category: ConversationCategory;
  preview: string;
  time: string;
  lastMessageAt?: string;
  unread: number;
  online: boolean;
  initials: string;
  avatarColor: string;
  participantCount?: number;
  participants: ConversationParticipant[];
  otherParticipant?: ConversationParticipant | null;
  targetUserId?: number;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  sender: "me" | "other";
  text: string;
  time: string;
  name?: string;
  senderRole?: string;
  senderUserId?: number;
  createdAt?: string;
  clientMessageId?: string;
  pending?: boolean;
};

export type BackendConversationParticipant = {
  id: number;
  user_id?: number | null;
  participant_type: string;
  display_name: string;
  role?: string | null;
  last_read_at?: string | null;
  joined_at?: string | null;
};

export type BackendConversation = {
  id: number;
  name: string;
  category: ConversationCategory;
  last_message?: string | null;
  last_message_at?: string | null;
  unread_count?: number;
  participant_count?: number;
  participants?: BackendConversationParticipant[];
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
  client_message_id?: string | null;
};

export type CreateConversationInput = {
  name: string;
  category?: ConversationCategory;
  participants: Array<{
    userId: number;
    participantType?: string;
    displayName?: string;
    role?: string;
  }>;
};