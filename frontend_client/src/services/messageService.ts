import {
  createConversation,
  createMessage,
  fetchConversation,
  fetchConversations,
  fetchMessages,
  findConversationByParticipantId,
  getCachedConversation,
  markConversationRead,
} from "../api/message";

export const messageService = {
  getConversation: fetchConversation,
  getConversations: fetchConversations,
  getMessages: fetchMessages,
  sendMessage: createMessage,
  markConversationRead,
  createConversation,
  findConversationByParticipantId,
  getCachedConversation,
};