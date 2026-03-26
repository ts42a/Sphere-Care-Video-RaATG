import {
  fetchConversations,
  fetchMessages,
  createMessage,
} from "../api/message";

export const messageService = {
  getConversations: fetchConversations,
  getMessages: fetchMessages,
  sendMessage: createMessage,
};