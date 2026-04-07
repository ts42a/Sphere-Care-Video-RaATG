import { useEffect, useMemo, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import PageHeader from "../../src/components/PageHeader";
import { messageService } from "../../src/services/messageService";
import { wsClient } from "../../src/services/wsClient";
import { mapRealtimeMessage } from "../../src/api/message";
import type { ConversationItem } from "../../src/types/message";
import { typography } from "../../src/theme/typography";

export default function MessageListScreen() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMessages("");
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadMessages(query);
    }, 220);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let unsubscribeMessage = () => {};
    let unsubscribeConversations = () => {};

    wsClient
      .connect()
      .then(() => {
        unsubscribeMessage = wsClient.subscribe("new_message", (payload) => {
          const conversationId = String(payload?.conversation_id ?? payload?.message?.conversation_id ?? "");
          const chatMessage = mapRealtimeMessage(payload?.message ?? payload);

          if (!conversationId || !chatMessage) return;

          setItems((prev) => {
            const next = [...prev];
            const index = next.findIndex((item) => item.id === conversationId);
            if (index === -1) {
              loadMessages(query);
              return prev;
            }

            const target = { ...next[index] };
            target.preview = chatMessage.text;
            target.time = chatMessage.time;
            if (chatMessage.sender !== "me") {
              target.unread = (target.unread || 0) + 1;
            }
            next.splice(index, 1);
            next.unshift(target);
            return next;
          });
        });

        unsubscribeConversations = wsClient.subscribe("conversations_update", () => {
          loadMessages(query);
        });
      })
      .catch((error) => {
        console.error("Failed to connect messages realtime", error);
      });

    return () => {
      unsubscribeMessage();
      unsubscribeConversations();
    };
  }, [query]);

  async function loadMessages(search: string) {
    try {
      if (!items.length) {
        setLoading(true);
      }
      const data = await messageService.getConversations(search);
      setItems(data);
    } catch (error) {
      console.error("Failed to load conversations", error);
    } finally {
      setLoading(false);
    }
  }

  const totalUnread = useMemo(
    () => items.reduce((sum, item) => sum + (item.unread || 0), 0),
    [items]
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.headerWrap}>
          <PageHeader title="Messages" showBack={false} />
          <Text style={styles.subtitle}>
            {totalUnread > 0 ? `${totalUnread} unread messages` : `${items.length} conversations`}
          </Text>
        </View>

        <View style={styles.searchWrap}>
          <Feather name="search" size={20} color="#99A1AC" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search messages..."
            placeholderTextColor="#A8AFBA"
            style={styles.searchInput}
          />
        </View>

        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color="#425266" />
          </View>
        ) : (
          <ScrollView
            style={styles.list}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 20 }}
          >
            {items.map((item) => (
              <Pressable
                key={item.id}
                style={styles.row}
                onPress={() =>
                  router.push({
                    pathname: "/messages/[contactId]",
                    params: {
                      contactId: item.id,
                      name: item.name,
                      initials: item.initials,
                      avatarColor: item.avatarColor,
                      role: item.role,
                    },
                  })
                }
              >
                <View style={[styles.avatar, { backgroundColor: item.avatarColor }]}> 
                  <Text style={styles.avatarText}>{item.initials}</Text>
                </View>

                <View style={styles.content}>
                  <View style={styles.topRow}>
                    <View>
                      <Text style={styles.name}>{item.name}</Text>
                      <Text style={styles.role}>{item.role}</Text>
                    </View>

                    <View style={styles.meta}>
                      {!!item.time && <Text style={styles.time}>{item.time}</Text>}
                      {item.unread > 0 && (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{item.unread}</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  <View style={styles.previewRow}>
                    {item.online && <View style={styles.onlineDot} />}
                    <Text style={styles.preview} numberOfLines={1}>
                      {item.preview || "No messages yet"}
                    </Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F7F7",
  },
  inner: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 10,
  },
  headerWrap: {
    marginBottom: 18,
  },
  subtitle: {
    ...typography.subText,
    marginTop: 6,
  },
  searchWrap: {
    height: 52,
    borderRadius: 18,
    backgroundColor: "#ECECEF",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    ...typography.body,
  },
  loaderWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  list: {
    flex: 1,
  },
  row: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    shadowColor: "#00000010",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  content: {
    flex: 1,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  name: {
    ...typography.cardTitle,
  },
  role: {
    ...typography.subText,
    marginTop: 2,
  },
  meta: {
    alignItems: "flex-end",
    marginLeft: 10,
  },
  time: {
    ...typography.subText,
    fontSize: 13,
    marginBottom: 6,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#27C27F",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#27C27F",
    marginRight: 8,
  },
  preview: {
    flex: 1,
    ...typography.subText,
    lineHeight: 20,
  },
});