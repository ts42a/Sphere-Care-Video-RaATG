export type ConversationCategory = "team" | "resident" | "alerts" | "direct";

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
  category?: ConversationCategory | string;
};

export type ChatMessage = {
  id: string;
  sender: "doctor" | "me";
  text: string;
  time: string;
  name?: string;
  senderRole?: string;
  conversationId?: string;
};

export type BackendConversation = {
  id: number;
  name: string;
  category: ConversationCategory | string;
  last_message?: string | null;
  last_message_at?: string | null;
  unread_count?: number | null;
  created_at?: string | null;
};

export type BackendMessage = {
  id: number;
  conversation_id: number;
  sender_name: string;
  sender_role: string;
  sender_user_id?: number | null;
  content: string;
  message_type?: string;
  is_self: boolean;
  created_at: string;
};

export type NewMessageEvent = {
  type: "new_message";
  conversation_id: number;
  message: {
    id: number;
    conversation_id: number;
    sender_name: string;
    sender_role: string;
    content: string;
    is_self: boolean;
    created_at: string;
  };
};