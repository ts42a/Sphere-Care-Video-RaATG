import { useEffect, useState } from "react";
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

import BottomNav from "../../src/components/BottomNav";
import { messageService } from "../../src/services/messageService";

import type { ConversationItem } from "../../src/types/message";

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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <Pressable onPress={() => router.replace("/")}>
            <Feather name="arrow-left" size={28} color="#4D5B6B" />
          </Pressable>

          <View style={styles.headerText}>
            <Text style={styles.title}>Messages</Text>
            <Text style={styles.subtitle}>{items.length} conversations</Text>
          </View>

          <Pressable>
            <Feather name="more-vertical" size={26} color="#4D5B6B" />
          </Pressable>
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
                    params: { contactId: item.contactId },
                  })
                }
              >
                <View
                  style={[
                    styles.avatar,
                    { backgroundColor: item.avatarColor },
                  ]}
                >
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

      <BottomNav active="message" />
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  headerText: {
    flex: 1,
    marginLeft: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#425266",
  },
  subtitle: {
    marginTop: 4,
    fontSize: 16,
    color: "#7A8595",
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
    color: "#425266",
    fontSize: 16,
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
    fontSize: 17,
    fontWeight: "700",
    color: "#2E3645",
  },
  role: {
    marginTop: 2,
    fontSize: 14,
    color: "#7A8595",
  },
  meta: {
    alignItems: "flex-end",
    marginLeft: 10,
  },
  time: {
    fontSize: 13,
    color: "#98A1AD",
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
    fontSize: 15,
    color: "#586474",
  },
});