import { useEffect, useState } from "react";
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
import { Feather, Ionicons, MaterialIcons } from "@expo/vector-icons";

import { callService } from "../../src/services/callService";
import { messageService } from "../../src/services/messageService";
import type { ChatMessage } from "../../src/types/message";
import type { CallContact } from "../../src/types/call";
import { typography } from "../../src/theme/typography";

export default function MessageChatScreen() {
  const { contactId } = useLocalSearchParams<{ contactId: string }>();

  const [contact, setContact] = useState<CallContact | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    if (contactId) {
      loadInitialData(contactId);
    }
  }, [contactId]);

  useEffect(() => {
    if (!contactId) return;

    const interval = setInterval(() => {
      refreshMessages(contactId);
    }, 3000);

    return () => clearInterval(interval);
  }, [contactId]);

  async function loadInitialData(id: string) {
    try {
      const [contactData, messageData] = await Promise.all([
        callService.getContactById(id),
        messageService.getMessages(id),
      ]);

      setContact(contactData);
      setMessages(messageData);
    } catch (error) {
      console.error("Failed to load chat data", error);
    }
  }

  async function refreshMessages(id: string) {
    try {
      const latest = await messageService.getMessages(id);
      setMessages(latest);
    } catch (error) {
      console.error("Failed to refresh messages", error);
    }
  }

  async function handleSend() {
    const trimmed = input.trim();

    if (!trimmed || !contactId) return;

    try {
      const newMessage = await messageService.sendMessage(contactId, trimmed);
      setMessages((prev) => [...prev, newMessage]);
      setInput("");
    } catch (error) {
      console.error("Failed to send message", error);
    }
  }

  const isOnline = contact?.online ?? false;

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
              { backgroundColor: contact?.avatarColor ?? "#3F7BF0" },
            ]}
          >
            <Text style={styles.avatarText}>{contact?.initials ?? "DR"}</Text>
          </View>

          <View style={styles.contactMeta}>
            <Text style={styles.contactName}>{contact?.name ?? "Loading..."}</Text>
            <View style={styles.onlineRow}>
              <View
                style={[
                  styles.onlineDot,
                  { opacity: isOnline ? 1 : 0.35 },
                ]}
              />
              <Text style={styles.onlineText}>
                {isOnline ? "Online" : "Offline"}
              </Text>
            </View>
          </View>

          <View style={styles.headerActions}>
            <Pressable
              onPress={() =>
                contact?.id &&
                router.push({
                  pathname: "/call/audio/[contactId]",
                  params: { contactId: contact.id },
                })
              }
            >
              <Feather name="phone-call" size={24} color="#5E6878" />
            </Pressable>

            <Pressable
              onPress={() =>
                contact?.id &&
                router.push({
                  pathname: "/call/video/[contactId]",
                  params: { contactId: contact.id },
                })
              }
            >
              <Feather name="video" size={24} color="#5E6878" />
            </Pressable>

            <Pressable>
              <Ionicons name="information-circle" size={24} color="#5E6878" />
            </Pressable>
          </View>
        </View>

        <ScrollView
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
                    {msg.time}   {msg.name}
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