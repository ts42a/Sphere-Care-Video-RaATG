import { request } from "./client";
import { getStoredUser } from "../services/sessionService";
import type { AuthUser } from "../types/auth";
import type {
  BackendConversation,
  BackendConversationParticipant,
  BackendMessage,
  ChatMessage,
  ConversationItem,
  ConversationParticipant,
  CreateConversationInput,
} from "../types/message";


const AVATAR_COLORS = ["#2EC4B6", "#7C3AED", "#DB2777", "#059669", "#D97706", "#0369A1", "#DC2626", "#9333EA"];

const conversationCache = new Map<string, ConversationItem>();

function initialsFromName(name: string) {
  return (name || "?")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
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

function toConversationParticipant(item: BackendConversationParticipant): ConversationParticipant {
  return {
    id: item.id,
    userId: item.user_id ?? undefined,
    participantType: item.participant_type || "user",
    displayName: item.display_name,
    role: item.role ?? undefined,
    lastReadAt: item.last_read_at,
    joinedAt: item.joined_at,
  };
}

function getOtherParticipant(
  participants: ConversationParticipant[],
  currentUser: AuthUser | null
): ConversationParticipant | null {
  if (!participants.length) return null;
  if (!currentUser?.id) return participants[0] ?? null;

  return (
    participants.find((participant) => participant.userId !== currentUser.id) ??
    participants[0] ??
    null
  );
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

async function mapConversation(item: BackendConversation): Promise<ConversationItem> {
  const currentUser = await getStoredUser<AuthUser>();
  const participants = (item.participants ?? []).map(toConversationParticipant);
  const otherParticipant = getOtherParticipant(participants, currentUser);
  const displayName = otherParticipant?.displayName || item.name;
  const displayRole = otherParticipant?.role || categoryLabel(item.category);
  const id = String(item.id);

  const mapped: ConversationItem = {
    id,
    contactId: id,
    name: displayName,
    role: displayRole,
    category: item.category,
    preview: item.last_message ?? "",
    time: formatTime(item.last_message_at),
    lastMessageAt: item.last_message_at ?? undefined,
    unread: item.unread_count ?? 0,
    online: false,
    initials: initialsFromName(displayName),
    avatarColor: AVATAR_COLORS[item.id % AVATAR_COLORS.length],
    participantCount: item.participant_count ?? participants.length,
    participants,
    otherParticipant,
    targetUserId: otherParticipant?.userId,
  };

  conversationCache.set(id, mapped);
  return mapped;
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
    senderUserId: item.sender_user_id ?? undefined,
    createdAt: item.created_at,
    clientMessageId: item.client_message_id ?? undefined,
  };
}

export function mapRealtimeMessage(payload: any): ChatMessage | null {
  if (!payload || typeof payload !== "object") return null;

  const candidate = payload.message ?? payload;

  if (
    candidate &&
    typeof candidate.conversation_id !== "undefined" &&
    typeof candidate.content !== "undefined"
  ) {
    return mapMessage(candidate as BackendMessage);
  }

  return null;
}

export function getCachedConversation(conversationId: string) {
  return conversationCache.get(String(conversationId)) ?? null;
}

export async function fetchConversations(search = ""): Promise<ConversationItem[]> {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  const response = await request<BackendConversation[]>(`/messages/conversations${query}`);
  return Promise.all(response.map(mapConversation));
}

export async function fetchConversation(conversationId: string): Promise<ConversationItem | null> {
  const cached = conversationCache.get(String(conversationId));
  if (cached) return cached;

  const response = await request<BackendConversation>(`/messages/conversations/${conversationId}`);
  return mapConversation(response);
}

export async function fetchMessages(conversationId: string): Promise<ChatMessage[]> {
  const response = await request<BackendMessage[]>(
    `/messages/conversations/${conversationId}/messages`
  );
  return response.map(mapMessage);
}
export async function markConversationRead(conversationId: string): Promise<void> {
  const updated = await request<BackendConversation>(
    `/messages/conversations/${conversationId}/read`,
    {
      method: "PATCH",
    }
  );

  const mapped = await mapConversation(updated);
  conversationCache.set(mapped.id, mapped);
}

function buildClientMessageId() {
  return `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function createMessage(conversationId: string, text: string): Promise<ChatMessage> {
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
        client_message_id: buildClientMessageId(),
      },
    }
  );

  const message = mapMessage(response);
  const cached = conversationCache.get(String(conversationId));

  if (cached) {
    conversationCache.set(String(conversationId), {
      ...cached,
      preview: message.text,
      time: message.time,
    });
  }

  return message;
}

export async function createConversation(input: CreateConversationInput): Promise<ConversationItem> {
  const response = await request<BackendConversation>("/messages/conversations", {
    method: "POST",
    body: {
      name: input.name,
      category: input.category ?? "direct",
      participants: input.participants.map((participant) => ({
        user_id: participant.userId,
        participant_type: participant.participantType ?? "user",
        display_name: participant.displayName,
        role: participant.role,
      })),
    },
  });

  return mapConversation(response);
}

export async function findConversationByParticipantId(userId: number): Promise<ConversationItem | null> {
  const cached = Array.from(conversationCache.values()).find(
    (conversation) => conversation.targetUserId === userId
  );
  if (cached) return cached;

  const conversations = await fetchConversations("");
  return conversations.find((conversation) => conversation.targetUserId === userId) ?? null;
}