import { useEffect, useMemo, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";

import { notificationService } from "../../src/services/notificationService";
import type { NotificationItem } from "../../src/types/notification";
import type { NotificationFilter } from "../../src/services/notificationService";

export default function NotificationScreen() {
  const [activeFilter, setActiveFilter] = useState<NotificationFilter>("all");
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNotifications(activeFilter);
  }, [activeFilter]);

  async function loadNotifications(filter: NotificationFilter) {
    try {
      setLoading(true);

      const [items, unread] = await Promise.all([
        notificationService.getNotifications(filter),
        notificationService.getUnreadCount(),
      ]);

      setNotifications(items);
      setUnreadCount(unread);
    } catch (error) {
      console.error("Failed to load notifications", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkRead(id: string) {
    try {
      await notificationService.markAsRead(id);
      await loadNotifications(activeFilter);
    } catch (error) {
      console.error("Failed to mark notification as read", error);
    }
  }

  async function handleMarkAllRead() {
    try {
      await notificationService.markAllAsRead();
      await loadNotifications(activeFilter);
    } catch (error) {
      console.error("Failed to mark all notifications as read", error);
    }
  }

  const unreadLabel = useMemo(() => {
    return `${unreadCount} unread`;
  }, [unreadCount]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <View style={styles.titleRow}>
            <Pressable onPress={() => router.back()} style={styles.backBtn}>
              <Feather name="arrow-left" size={28} color="#425266" />
            </Pressable>

            <Text style={styles.pageTitle}>Notifications</Text>
          </View>

          <Pressable>
            <Feather name="more-vertical" size={26} color="#425266" />
          </Pressable>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>{unreadLabel}</Text>

          <Pressable onPress={handleMarkAllRead}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </Pressable>
        </View>

        <View style={styles.filterRow}>
          <Pressable
            style={[
              styles.filterPill,
              activeFilter === "all" && styles.filterPillActive,
            ]}
            onPress={() => setActiveFilter("all")}
          >
            <Text
              style={[
                styles.filterText,
                activeFilter === "all" && styles.filterTextActive,
              ]}
            >
              All
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.filterPill,
              activeFilter === "unread" && styles.filterPillActive,
            ]}
            onPress={() => setActiveFilter("unread")}
          >
            <Text
              style={[
                styles.filterText,
                activeFilter === "unread" && styles.filterTextActive,
              ]}
            >
              Unread ({unreadCount})
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color="#46576D" />
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptyText}>You’re all caught up.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {notifications.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <View
                  style={[
                    styles.dotAvatar,
                    getAvatarStyle(item.type),
                  ]}
                />

                <View style={styles.itemContent}>
                  <View style={styles.itemTopRow}>
                    <Text style={styles.itemTitle}>{item.title}</Text>
                    <Text style={styles.timeText}>{item.timeAgo}</Text>
                  </View>

                  <Text style={styles.itemMessage}>{item.message}</Text>

                  <View style={styles.actionRow}>
                    {item.action ? (
                      <Pressable
                        style={[
                          styles.actionBtn,
                          item.action.variant === "red" && styles.actionBtnRed,
                          item.action.variant === "blue" && styles.actionBtnBlue,
                        ]}
                      >
                        <Text style={styles.actionBtnText}>{item.action.label}</Text>
                      </Pressable>
                    ) : (
                      <View />
                    )}

                    {!item.isRead && (
                      <Pressable onPress={() => handleMarkRead(item.id)}>
                        <Text style={styles.markReadText}>Mark read</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function getAvatarStyle(type: NotificationItem["type"]) {
  switch (type) {
    case "medication":
      return { backgroundColor: "#F7E9EA" };
    case "task":
      return { backgroundColor: "#E6F3EA" };
    case "lab":
      return { backgroundColor: "#E8EEF8" };
    case "handoff":
      return { backgroundColor: "#F3F0DD" };
    default:
      return { backgroundColor: "#ECEFF4" };
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F7F7",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 26,
    paddingHorizontal: 24,
    paddingBottom: 28,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: {
    marginRight: 12,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1F2A3D",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  summaryText: {
    fontSize: 15,
    color: "#6F7B8A",
  },
  markAllText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#22B24C",
  },
  filterRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 28,
  },
  filterPill: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: "#EEF0F4",
  },
  filterPillActive: {
    backgroundColor: "#0A1633",
  },
  filterText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#4E5A6A",
  },
  filterTextActive: {
    color: "#FFFFFF",
  },
  loaderWrap: {
    paddingTop: 40,
    alignItems: "center",
  },
  emptyWrap: {
    paddingTop: 48,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#425266",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: "#6A7A90",
  },
  list: {
    gap: 26,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  dotAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginRight: 18,
  },
  itemContent: {
    flex: 1,
    paddingTop: 2,
  },
  itemTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  itemTitle: {
    flex: 1,
    fontSize: 19,
    fontWeight: "700",
    color: "#1F2433",
    marginRight: 12,
  },
  timeText: {
    fontSize: 15,
    color: "#6F7B8A",
  },
  itemMessage: {
    fontSize: 16,
    lineHeight: 22,
    color: "#556274",
    marginBottom: 14,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  actionBtn: {
    minWidth: 142,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnRed: {
    backgroundColor: "#EC2B2B",
  },
  actionBtnBlue: {
    backgroundColor: "#3566E8",
  },
  actionBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  markReadText: {
    fontSize: 15,
    color: "#6F7B8A",
  },
});