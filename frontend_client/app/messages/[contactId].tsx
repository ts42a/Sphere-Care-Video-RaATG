import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Feather, Ionicons, MaterialIcons } from "@expo/vector-icons";

import { messageService } from "../../src/services/messageService";
import { wsClient } from "../../src/services/wsClient";
import type { ChatMessage, ConversationItem, NewMessageEvent } from "../../src/types/message";
import { typography } from "../../src/theme/typography";

export default function MessageChatScreen() {
  const { contactId } = useLocalSearchParams<{ contactId: string }>();
  const scrollRef = useRef<ScrollView | null>(null);

  const [conversation, setConversation] = useState<ConversationItem | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");

  const conversationId = useMemo(() => contactId ?? "", [contactId]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const appendMessage = useCallback((incoming: ChatMessage) => {
    setMessages((current) => {
      if (current.some((item) => item.id === incoming.id)) {
        return current;
      }

      return [...current, incoming];
    });
  }, []);

  const loadInitialData = useCallback(async (id: string) => {
    if (!id) return;

    try {
      const [conversationData, messageData] = await Promise.all([
        messageService.getConversationById(id),
        messageService.getMessages(id),
      ]);

      setConversation({
        ...conversationData,
        unread: 0,
      });
      setMessages(messageData);
      await messageService.markConversationRead(id);
      scrollToBottom();
    } catch (error) {
      console.error("Failed to load chat data", error);
    }
  }, [scrollToBottom]);

  useEffect(() => {
    if (conversationId) {
      loadInitialData(conversationId);
    }
  }, [conversationId, loadInitialData]);

  useFocusEffect(
    useCallback(() => {
      if (!conversationId) return;

      messageService.markConversationRead(conversationId).catch((error) => {
        console.error("Failed to mark conversation read", error);
      });
    }, [conversationId])
  );

  useEffect(() => {
    if (!conversationId) return;

    const unsubscribe = wsClient.subscribe<NewMessageEvent>("new_message", async (event) => {
      if (String(event.conversation_id) !== conversationId) {
        return;
      }

      const incoming = messageService.mapRealtimeMessageEvent(event);
      appendMessage(incoming);
      setConversation((current) => {
        if (!current) return current;

        return {
          ...current,
          preview: incoming.text,
          time: incoming.time,
          unread: 0,
        };
      });

      try {
        await messageService.markConversationRead(conversationId);
      } catch (error) {
        console.error("Failed to update read state", error);
      }

      scrollToBottom();
    });

    return unsubscribe;
  }, [appendMessage, conversationId, scrollToBottom]);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  async function handleSend() {
    const trimmed = input.trim();

    if (!trimmed || !conversationId) return;

    try {
      const newMessage = await messageService.sendMessage(conversationId, trimmed);
      appendMessage(newMessage);
      setConversation((current) => {
        if (!current) return current;

        return {
          ...current,
          preview: newMessage.text,
          time: newMessage.time,
          unread: 0,
        };
      });
      setInput("");
      scrollToBottom();
    } catch (error) {
      console.error("Failed to send message", error);
    }
  }

  const isOnline = conversation?.online ?? false;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.replace("/messages")}>
            <Feather name="arrow-left" size={28} color="#4D5B6B" />
          </Pressable>

          <View
            style={[
              styles.avatar,
              { backgroundColor: conversation?.avatarColor ?? "#3F7BF0" },
            ]}
          >
            <Text style={styles.avatarText}>{conversation?.initials ?? "SC"}</Text>
          </View>

          <View style={styles.contactMeta}>
            <Text style={styles.contactName}>{conversation?.name ?? "Loading..."}</Text>
            <View style={styles.onlineRow}>
              <View
                style={[
                  styles.onlineDot,
                  { opacity: isOnline ? 1 : 0.35 },
                ]}
              />
              <Text style={styles.onlineText}>
                {isOnline ? "Online" : conversation?.role ?? "Conversation"}
              </Text>
            </View>
          </View>

          <View style={styles.headerActions}>
            <Pressable>
              <Feather name="phone-call" size={24} color="#5E6878" />
            </Pressable>

            <Pressable>
              <Feather name="video" size={24} color="#5E6878" />
            </Pressable>

            <Pressable>
              <Ionicons name="information-circle" size={24} color="#5E6878" />
            </Pressable>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.thread}
          contentContainerStyle={styles.threadContent}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((msg) => (
            <View key={msg.id} style={styles.messageBlock}>
              {msg.sender === "doctor" ? (
                <>
                  <View style={styles.doctorBubble}>
                    <Text style={styles.doctorBubbleText}>{msg.text}</Text>
                  </View>

                  <Text style={styles.doctorMeta}>
                    {msg.time}
                    {msg.name ? `   ${msg.name}` : ""}
                  </Text>
                </>
              ) : (
                <>
                  <View style={styles.meBubble}>
                    <Text style={styles.meBubbleText}>{msg.text}</Text>
                  </View>

                  <View style={styles.meMetaRow}>
                    <Text style={styles.meMeta}>{msg.time}</Text>
                    <MaterialIcons
                      name="done-all"
                      size={18}
                      color="#1EB980"
                    />
                  </View>
                </>
              )}
            </View>
          ))}
        </ScrollView>

        <View style={styles.inputRow}>
          <Pressable style={styles.attachBtn}>
            <MaterialIcons
              name="chat-bubble-outline"
              size={22}
              color="#6B7482"
            />
          </Pressable>

          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Type a message..."
            placeholderTextColor="#A8AFBA"
            style={styles.input}
          />

          <Pressable style={styles.sendBtn} onPress={handleSend}>
            <Ionicons name="send" size={22} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F7F7",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 14,
    marginRight: 12,
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
  },
  contactMeta: {
    flex: 1,
  },
  contactName: {
    ...typography.cardTitle,
    fontSize: 18,
    marginBottom: 4,
  },
  onlineRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#21C36A",
    marginRight: 8,
  },
  onlineText: {
    ...typography.subText,
    color: "#18B76A",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginLeft: 10,
  },
  thread: {
    flex: 1,
    paddingHorizontal: 20,
  },
  threadContent: {
    paddingTop: 20,
    paddingBottom: 18,
  },
  messageBlock: {
    marginBottom: 18,
  },
  doctorBubble: {
    maxWidth: "86%",
    backgroundColor: "#ECECEF",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  doctorBubbleText: {
    ...typography.body,
    lineHeight: 24,
  },
  doctorMeta: {
    ...typography.subText,
    fontSize: 13,
    marginTop: 8,
  },
  meBubble: {
    alignSelf: "flex-end",
    maxWidth: "86%",
    backgroundColor: "#0E8A62",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  meBubbleText: {
    fontSize: 16,
    color: "#FFFFFF",
    lineHeight: 24,
  },
  meMetaRow: {
    marginTop: 8,
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  meMeta: {
    ...typography.subText,
    fontSize: 13,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 12,
  },
  attachBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#ECECEF",
    paddingHorizontal: 18,
    ...typography.body,
  },
  sendBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#1CC487",
    alignItems: "center",
    justifyContent: "center",
  },
});