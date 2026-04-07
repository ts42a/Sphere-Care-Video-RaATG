import { USE_MOCK_API } from "../config/api";
import { request } from "./client";
import { getStoredUser } from "../services/sessionService";
import type { AuthUser } from "../types/auth";
import type { BackendConversation, BackendMessage, ChatMessage, ConversationItem } from "../types/message";
import { mockChatMessages, mockConversations } from "../mock/callData";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let inMemoryMessages: Record<string, ChatMessage[]> = Object.fromEntries(
  Object.entries(mockChatMessages).map(([key, value]) => [
    key,
    value.map((item) => ({
      id: item.id,
      conversationId: key,
      sender: item.sender === "me" ? "me" : "other",
      text: item.text,
      time: item.time,
      name: item.name,
    })),
  ])
);

const AVATAR_COLORS = ["#2EC4B6", "#7C3AED", "#DB2777", "#059669", "#D97706", "#0369A1", "#DC2626", "#9333EA"];

function initialsFromName(name: string) {
  return (name || "?")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function categoryLabel(category?: string) {
  return (
    {
      team: "Team chat",
      resident: "Resident care",
      alerts: "System alerts",
      direct: "Direct message",
    } as Record<string, string>
  )[category || ""] || "Conversation";
}

function formatTime(value?: string | null) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function mapConversation(item: BackendConversation): ConversationItem {
  return {
    id: String(item.id),
    name: item.name,
    role: categoryLabel(item.category),
    category: item.category,
    preview: item.last_message ?? "",
    time: formatTime(item.last_message_at),
    unread: item.unread_count ?? 0,
    online: false,
    initials: initialsFromName(item.name),
    avatarColor: AVATAR_COLORS[item.id % AVATAR_COLORS.length],
    participantCount: item.participant_count ?? 0,
  };
}

function mapMessage(item: BackendMessage): ChatMessage {
  return {
    id: String(item.id),
    conversationId: String(item.conversation_id),
    sender: item.is_self ? "me" : "other",
    text: item.content,
    time: formatTime(item.created_at),
    name: item.sender_name,
    senderRole: item.sender_role || undefined,
    createdAt: item.created_at,
  };
}

export function mapRealtimeMessage(payload: any): ChatMessage | null {
  if (!payload || typeof payload !== "object") return null;
  if (payload.message_type && payload.content !== undefined) {
    return mapMessage(payload as BackendMessage);
  }
  return null;
}

export async function fetchConversations(search = ""): Promise<ConversationItem[]> {
  if (USE_MOCK_API) {
    await wait(150);

    const keyword = search.trim().toLowerCase();

    const mapped = mockConversations.map((item) => {
      const currentMessages = inMemoryMessages[item.contactId] ?? [];
      const lastMessage = currentMessages[currentMessages.length - 1];

      return {
        id: item.contactId,
        name: item.name,
        role: item.role,
        category: "direct",
        preview: lastMessage?.text ?? item.preview,
        time: lastMessage?.time ?? item.time,
        unread: item.unread,
        online: item.online,
        initials: item.initials,
        avatarColor: item.avatarColor,
      } as ConversationItem;
    });

    if (!keyword) return mapped;

    return mapped.filter((item) =>
      `${item.name} ${item.role} ${item.preview}`
        .toLowerCase()
        .includes(keyword)
    );
  }

  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  const response = await request<BackendConversation[]>(`/messages/conversations${query}`);
  return response.map(mapConversation);
}

export async function fetchConversation(conversationId: string): Promise<ConversationItem | null> {
  if (USE_MOCK_API) {
    const item = mockConversations.find((entry) => entry.contactId === conversationId);
    return item
      ? {
          id: item.contactId,
          name: item.name,
          role: item.role,
          category: "direct",
          preview: item.preview,
          time: item.time,
          unread: item.unread,
          online: item.online,
          initials: item.initials,
          avatarColor: item.avatarColor,
        }
      : null;
  }

  const response = await request<BackendConversation>(`/messages/conversations/${conversationId}`);
  return mapConversation(response);
}

export async function fetchMessages(conversationId: string): Promise<ChatMessage[]> {
  if (USE_MOCK_API) {
    await wait(120);
    return inMemoryMessages[conversationId] ?? [];
  }

  const response = await request<BackendMessage[]>(
    `/messages/conversations/${conversationId}/messages`
  );
  return response.map(mapMessage);
}

export async function markConversationRead(conversationId: string): Promise<void> {
  if (USE_MOCK_API) return;
  await request<BackendConversation>(`/messages/conversations/${conversationId}/read`, {
    method: "PATCH",
  });
}

export async function createMessage(conversationId: string, text: string): Promise<ChatMessage> {
  if (USE_MOCK_API) {
    await wait(120);

    const message: ChatMessage = {
      id: `msg-${Date.now()}`,
      conversationId,
      sender: "me",
      text,
      time: formatTime(new Date().toISOString()),
    };

    const current = inMemoryMessages[conversationId] ?? [];
    inMemoryMessages[conversationId] = [...current, message];

    return message;
  }

  const currentUser = await getStoredUser<AuthUser>();
  const response = await request<BackendMessage>(
    `/messages/conversations/${conversationId}/messages`,
    {
      method: "POST",
      body: {
        conversation_id: Number(conversationId),
        sender_name: currentUser?.full_name ?? "Me",
        sender_role: currentUser?.role ?? "client",
        content: text,
        is_self: true,
      },
    }
  );

  return mapMessage(response);
}