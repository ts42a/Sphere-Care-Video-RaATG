import {
  fetchConversations,
  fetchConversationById,
  fetchMessages,
  createMessage,
  markConversationRead,
  mapRealtimeMessageEvent,
} from "../api/message";

export const messageService = {
  getConversations: fetchConversations,
  getConversationById: fetchConversationById,
  getMessages: fetchMessages,
  sendMessage: createMessage,
  markConversationRead,
  mapRealtimeMessageEvent,
};