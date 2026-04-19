import { useEffect, useMemo, useRef, useState } from "react";
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
import { router, useLocalSearchParams } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";

import { mapRealtimeMessage } from "../../src/api/message";
import { messageService } from "../../src/services/messageService";
import { callService } from "../../src/services/callService";
import { miniCallService } from "../../src/services/miniCallService";
import { wsClient } from "../../src/services/wsClient";
import type { ChatMessage, ConversationItem } from "../../src/types/message";
import { typography } from "../../src/theme/typography";

export default function MessageChatScreen() {
  const params = useLocalSearchParams<{
    contactId: string;
    name?: string;
    initials?: string;
    avatarColor?: string;
    role?: string;
  }>();

  const conversationId = String(params.contactId || "");
  const scrollRef = useRef<ScrollView | null>(null);

  const [conversation, setConversation] = useState<ConversationItem | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    if (conversationId) {
      loadInitialData(conversationId);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;

    let unsubscribeMessage = () => {};
    let unsubscribeConversation = () => {};

    wsClient
      .connect()
      .then(() => {
        unsubscribeMessage = wsClient.subscribe("new_message", async (payload) => {
          const payloadConversationId = String(
            payload?.conversation_id ?? payload?.message?.conversation_id ?? ""
          );
          if (payloadConversationId !== conversationId) return;

          const chatMessage = mapRealtimeMessage(payload?.message ?? payload);
          if (!chatMessage) return;

          setMessages((prev) => {
            if (prev.some((item) => item.id === chatMessage.id)) {
              return prev;
            }
            return [...prev, chatMessage];
          });

          if (chatMessage.sender !== "me") {
            await messageService.markConversationRead(conversationId).catch(() => {});
          }
        });

        unsubscribeConversation = wsClient.subscribe("conversations_update", async () => {
          const latest = await messageService.getConversation(conversationId);
          if (latest) setConversation(latest);
        });
      })
      .catch((error) => {
        console.error("Failed to connect chat realtime", error);
      });

    return () => {
      unsubscribeMessage();
      unsubscribeConversation();
    };
  }, [conversationId]);

  useEffect(() => {
    if (!messages.length) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [messages.length]);

  async function loadInitialData(id: string) {
    try {
      const [conversationData, messageData] = await Promise.all([
        messageService.getConversation(id),
        messageService.getMessages(id),
      ]);

      setConversation(
        conversationData || {
          id,
          contactId: id,
          name: params.name || "Conversation",
          role: params.role || "Conversation",
          category: "direct",
          preview: "",
          time: "",
          unread: 0,
          online: false,
          initials: params.initials || "CH",
          avatarColor: params.avatarColor || "#3F7BF0",
          participants: [],
          otherParticipant: null,
          targetUserId: undefined,
        }
      );
      setMessages(messageData);
      await messageService.markConversationRead(id).catch(() => {});
    } catch (error) {
      console.error("Failed to load chat data", error);
    }
  }

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || !conversationId) return;

    try {
      const newMessage = await messageService.sendMessage(conversationId, trimmed);
      setMessages((prev) => {
        if (prev.some((item) => item.id === newMessage.id)) {
          return prev;
        }
        return [...prev, newMessage];
      });
      setConversation((prev) =>
        prev
          ? {
              ...prev,
              preview: newMessage.text,
              time: newMessage.time,
            }
          : prev
      );
      setInput("");
    } catch (error) {
      console.error("Failed to send message", error);
    }
  }

  const headerName = useMemo(
    () => conversation?.name || params.name || "Conversation",
    [conversation?.name, params.name]
  );
  const headerInitials = useMemo(
    () => conversation?.initials || params.initials || "CH",
    [conversation?.initials, params.initials]
  );
  const headerRole = useMemo(
    () => conversation?.role || params.role || "Conversation",
    [conversation?.role, params.role]
  );
  const avatarColor = conversation?.avatarColor || params.avatarColor || "#3F7BF0";
  const canCall = Boolean(conversation?.targetUserId);

  async function handleStartCall(mode: "audio" | "video") {
    if (!conversation?.targetUserId) return;

    try {
      const contact = await callService.getContactById(conversationId);
      const session = await callService.startCall({ mode, contact });
      miniCallService.setState({
        active: true,
        minimized: false,
        mode,
        callId: session.callId,
        contactId: contact.id,
        contactName: contact.name,
      });
      router.push({
        pathname: mode === "video" ? "/call/video/[contactId]" : "/call/audio/[contactId]",
        params: { contactId: contact.id, callId: String(session.callId) },
      });
    } catch (callError) {
      console.error("Failed to start call from messages", callError);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.replace("/(tab)/messages")}>
            <Feather name="arrow-left" size={28} color="#4D5B6B" />
          </Pressable>

          <View style={[styles.avatar, { backgroundColor: avatarColor }]}> 
            <Text style={styles.avatarText}>{headerInitials}</Text>
          </View>

          <View style={styles.contactMeta}>
            <Text style={styles.contactName}>{headerName}</Text>
            <View style={styles.onlineRow}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlineText}>{headerRole}</Text>
            </View>
          </View>

          <View style={styles.headerActions}>
            <Pressable
              disabled={!canCall}
              style={!canCall ? styles.iconBtnDisabled : undefined}
              onPress={() => canCall && handleStartCall("audio")}
            >
              <Feather name="phone-call" size={24} color={canCall ? "#5E6878" : "#A8AFBA"} />
            </Pressable>
            <Pressable
              disabled={!canCall}
              style={!canCall ? styles.iconBtnDisabled : undefined}
              onPress={() => canCall && handleStartCall("video")}
            >
              <Feather name="video" size={24} color={canCall ? "#5E6878" : "#A8AFBA"} />
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
              {msg.sender === "other" ? (
                <>
                  <View style={styles.otherBubble}>
                    <Text style={styles.otherBubbleText}>{msg.text}</Text>
                  </View>

                  <Text style={styles.otherMeta}>
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
                    <Ionicons name="checkmark-done" size={18} color="#1EB980" />
                  </View>
                </>
              )}
            </View>
          ))}
        </ScrollView>

        <View style={styles.inputRow}>
          <Pressable style={styles.attachBtn}>
            <Feather name="paperclip" size={22} color="#6B7482" />
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
  iconBtnDisabled: {
    opacity: 0.5,
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
  otherBubble: {
    maxWidth: "86%",
    backgroundColor: "#ECECEF",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  otherBubbleText: {
    ...typography.body,
    lineHeight: 24,
  },
  otherMeta: {
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