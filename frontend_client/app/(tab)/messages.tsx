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
          const conversationId = String(
            payload?.conversation_id ?? payload?.message?.conversation_id ?? ""
          );
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
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{item.name}</Text>
                      {!!item.role && <Text style={styles.role}>{item.role}</Text>}
                    </View>

                    <View style={styles.meta}>
                      <Text style={styles.time}>{item.time}</Text>
                      {item.unread > 0 && (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{item.unread}</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  <View style={styles.previewRow}>
                    {item.online && <View style={styles.onlineDot} />}
                    <Text numberOfLines={1} style={styles.preview}>
                      {item.preview}
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
    paddingTop: 18,
    paddingHorizontal: 24,
  },
  headerWrap: {
    marginBottom: 20,
  },
  subtitle: {
    ...typography.subText,
    marginTop: 4,
  },
  searchWrap: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E5EA",
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
    flexDirection: "row",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#E9EBEF",
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  avatarText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 22,
  },
  content: {
    flex: 1,
    justifyContent: "center",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
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
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#27C27F",
    marginRight: 8,
  },
  preview: {
    flex: 1,
    ...typography.body,
    color: "#5E6878",
  },
});