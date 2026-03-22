import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";

import { notificationService } from "../services/notificationService";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type HeaderBarProps = {
  userName: string;
};

export default function HeaderBar({ userName }: HeaderBarProps) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    loadUnreadCount();
  }, [pathname]);

  async function loadUnreadCount() {
    try {
      const count = await notificationService.getUnreadCount();
      setUnreadCount(count);
    } catch (error) {
      console.error("Failed to load unread count", error);
    }
  }

  return (
    <View style={styles.headerBar}>
      <Pressable style={styles.headerUser} onPress={() => router.push("./profile")}>
        <View style={styles.userAvatarIcon}>
          <View style={styles.avatarHead} />
          <View style={styles.avatarBody} />
        </View>

        <Text style={styles.headerGreeting}>Hello, {userName}</Text>
      </Pressable>

      <View style={styles.headerActions}>
        <Pressable
          style={styles.iconButton}
          onPress={() => router.push("/notifications")}
        >
          <Feather name="bell" size={24} color={colors.icon} />
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </Text>
            </View>
          )}
        </Pressable>

        <Pressable onPress={() => router.push("/settings")}>
          <Feather name="settings" size={24} color={colors.icon} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xxl,
  },
  headerUser: {
    flexDirection: "row",
    alignItems: "center",
  },
  userAvatarIcon: {
    width: 32,
    height: 32,
    borderWidth: 2,
    borderColor: "#5E6D7D",
    borderRadius: 16,
    position: "relative",
    marginRight: 10,
  },
  avatarHead: {
    position: "absolute",
    left: 10,
    top: 5,
    width: 8,
    height: 8,
    borderWidth: 2,
    borderColor: "#5E6D7D",
    borderRadius: 8,
  },
  avatarBody: {
    position: "absolute",
    left: 7,
    bottom: 5,
    width: 14,
    height: 7,
    borderWidth: 2,
    borderColor: "#5E6D7D",
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderBottomWidth: 0,
  },
  headerGreeting: {
    fontSize: 22,
    color: colors.icon,
    fontWeight: "500",
  },
  headerActions: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  iconButton: {
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: -7,
    right: -9,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.badge,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: colors.surface,
    fontSize: 10,
    fontWeight: "700",
  },
});