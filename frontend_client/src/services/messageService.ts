import {
  fetchConversation,
  fetchConversations,
  fetchMessages,
  createMessage,
  markConversationRead,
} from "../api/message";

export const messageService = {
  getConversation: fetchConversation,
  getConversations: fetchConversations,
  getMessages: fetchMessages,
  sendMessage: createMessage,
  markConversationRead,
};