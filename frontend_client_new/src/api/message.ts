import { USE_MOCK_API } from "../config/api";
import { request } from "./client";
import type { ApiActionResponse, ApiItemResponse, ApiListResponse } from "../types/api";
import type { ChatMessage, ConversationItem } from "../types/message";
import {
  mockChatMessages,
  mockConversations,
} from "../mock/callData";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let inMemoryMessages: Record<string, ChatMessage[]> = {
  ...mockChatMessages,
};

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
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

  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  const response = await request<ApiListResponse<ConversationItem>>(`/messages${query}`);
  return response.data;
}

export async function fetchMessages(contactId: string): Promise<ChatMessage[]> {
  if (USE_MOCK_API) {
    await wait(120);
    return inMemoryMessages[contactId] ?? [];
  }

  const response = await request<ApiListResponse<ChatMessage>>(
    `/messages/${contactId}`
  );
  return response.data;
}

export async function createMessage(contactId: string, text: string): Promise<ChatMessage> {
  if (USE_MOCK_API) {
    await wait(120);

    const message: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: "me",
      text,
      time: formatTime(),
    };

    const current = inMemoryMessages[contactId] ?? [];
    inMemoryMessages[contactId] = [...current, message];

    return message;
  }

  const response = await request<ApiItemResponse<ChatMessage>>(
    `/messages/${contactId}`,
    {
      method: "POST",
      body: { text },
    }
  );

  return response.data;
}