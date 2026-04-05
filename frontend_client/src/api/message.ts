import { USE_MOCK_API } from "../config/api";
import { request } from "./client";
import type {
  BackendConversation,
  BackendMessage,
  ChatMessage,
  ConversationItem,
  NewMessageEvent,
} from "../types/message";
import { mockChatMessages, mockConversations } from "../mock/callData";
import { getStoredUser } from "../services/sessionService";
import type { AuthUser } from "../types/auth";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let inMemoryMessages: Record<string, ChatMessage[]> = {
  ...mockChatMessages,
};

function formatTimeLabel(value?: string | Date | null) {
  if (!value) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) return "";

    if (/^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(trimmed)) {
      return trimmed.replace(/\s+/g, " ").toUpperCase();
    }

    const parsed = new Date(trimmed);

    if (Number.isNaN(parsed.getTime())) {
      return trimmed;
    }

    return parsed.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return value.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "SC";
}

function getAvatarColor(conversationId: number | string, category?: string) {
  if (category === "alerts") return "#EF4444";
  if (category === "resident") return "#7C3AED";
  if (category === "team") return "#2EC4B6";

  const palette = [
    "#3F7BF0",
    "#6558F5",
    "#17C2B8",
    "#8D63FF",
    "#27C27F",
    "#F59E0B",
    "#EC4899",
  ];

  const seed = Number(conversationId) || String(conversationId).length;
  return palette[Math.abs(seed) % palette.length];
}

function getConversationRole(category?: string) {
  switch (category) {
    case "team":
      return "Team Chat";
    case "resident":
      return "Resident Care";
    case "alerts":
      return "System Alerts";
    default:
      return "Direct Message";
  }
}

export function mapBackendConversation(conversation: BackendConversation): ConversationItem {
  return {
    id: String(conversation.id),
    contactId: String(conversation.id),
    initials: getInitials(conversation.name),
    name: conversation.name,
    role: getConversationRole(conversation.category),
    preview: conversation.last_message ?? "",
    time: formatTimeLabel(conversation.last_message_at),
    unread: conversation.unread_count ?? 0,
    online: false,
    avatarColor: getAvatarColor(conversation.id, conversation.category),
    category: conversation.category,
  };
}

export function mapBackendMessage(message: BackendMessage): ChatMessage {
  return {
    id: String(message.id),
    sender: message.is_self ? "me" : "doctor",
    text: message.content,
    time: formatTimeLabel(message.created_at),
    name: message.sender_name,
    senderRole: message.sender_role,
    conversationId: String(message.conversation_id),
  };
}

export function mapRealtimeMessageEvent(event: NewMessageEvent): ChatMessage {
  return {
    id: String(event.message.id),
    sender: event.message.is_self ? "me" : "doctor",
    text: event.message.content,
    time: formatTimeLabel(event.message.created_at),
    name: event.message.sender_name,
    senderRole: event.message.sender_role,
    conversationId: String(event.conversation_id),
  };
}

export async function fetchConversations(search = ""): Promise<ConversationItem[]> {
  if (USE_MOCK_API) {
    await wait(150);

    const keyword = search.trim().toLowerCase();

    const mapped = mockConversations.map((item) => {
      const currentMessages = inMemoryMessages[item.contactId] ?? [];
      const lastMessage = currentMessages[currentMessages.length - 1];

      return {
        ...item,
        preview: lastMessage?.text ?? item.preview,
        time: lastMessage?.time ?? item.time,
      };
    });

    if (!keyword) return mapped;

    return mapped.filter((item) =>
      `${item.name} ${item.role} ${item.preview}`
        .toLowerCase()
        .includes(keyword)
    );
  }

  const response = await request<BackendConversation[]>("/messages/conversations");
  const mapped = response.map(mapBackendConversation);
  const keyword = search.trim().toLowerCase();

  if (!keyword) {
    return mapped;
  }

  return mapped.filter((item) =>
    `${item.name} ${item.role} ${item.preview}`.toLowerCase().includes(keyword)
  );
}

export async function fetchConversationById(contactId: string): Promise<ConversationItem> {
  if (USE_MOCK_API) {
    await wait(80);

    const conversation = mockConversations.find((item) => item.contactId === contactId);

    if (!conversation) {
      throw new Error("Conversation not found");
    }

    return conversation;
  }

  const conversations = await fetchConversations();
  const conversation = conversations.find((item) => item.contactId === contactId);

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  return conversation;
}

export async function fetchMessages(contactId: string): Promise<ChatMessage[]> {
  if (USE_MOCK_API) {
    await wait(120);
    return inMemoryMessages[contactId] ?? [];
  }

  const response = await request<BackendMessage[]>(
    `/messages/conversations/${contactId}/messages`
  );

  return response.map(mapBackendMessage);
}

export async function createMessage(contactId: string, text: string): Promise<ChatMessage> {
  if (USE_MOCK_API) {
    await wait(120);

    const message: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: "me",
      text,
      time: formatTimeLabel(new Date()),
      conversationId: contactId,
    };

    const current = inMemoryMessages[contactId] ?? [];
    inMemoryMessages[contactId] = [...current, message];

    return message;
  }

  const user = await getStoredUser<AuthUser>();
  const response = await request<BackendMessage>(
    `/messages/conversations/${contactId}/messages`,
    {
      method: "POST",
      body: {
        conversation_id: Number(contactId),
        sender_name: user?.full_name ?? user?.email ?? "Client User",
        sender_role: user?.role ?? "client",
        content: text,
        is_self: true,
      },
    }
  );

  return mapBackendMessage(response);
}

export async function markConversationRead(contactId: string): Promise<void> {
  if (USE_MOCK_API) {
    await wait(80);
    return;
  }

  await request(`/messages/conversations/${contactId}/read`, {
    method: "PATCH",
  });
}