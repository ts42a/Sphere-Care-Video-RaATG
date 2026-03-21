import { useState, useCallback } from "react";
import { router, useFocusEffect } from "expo-router";
import { Ionicons, Feather } from "@expo/vector-icons";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
} from "react-native";

import { Images } from "../src/constants/images";
import ReminderCard from "../src/components/ReminderCard";
import QuickActionCard from "../src/components/QuickActionCard";
import TaskCard from "../src/components/TaskCard";
import BottomNav from "../src/components/BottomNav";
import { profileService } from "../src/services/profileService";
import { notificationService } from "../src/services/notificationService";
import { colors } from "../src/theme/colors";
import { spacing } from "../src/theme/spacing";

export default function HomeScreen() {
  const [userName, setUserName] = useState("User");
  const [notificationCount, setNotificationCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      async function loadHomeData() {
        try {
          const profile = await profileService.getProfile();
          setUserName(profile.personal.firstName || "User");
        } catch (error) {
          setUserName("User");
        }

        try {
          const unreadCount = await notificationService.getUnreadCount();
          setNotificationCount(unreadCount || 0);
        } catch (error) {
          setNotificationCount(0);
        }
      }

      loadHomeData();
    }, [])
  );

  const tasks = [
    {
      id: 1,
      category: "Medication",
      name: "Name of the medication in full",
      time: "8:00",
      type: "green" as const,
      icon: <Ionicons name="medical-outline" size={26} color="#27C27F" />,
    },
    {
      id: 2,
      category: "Exercise",
      name: "Morning walk for 20 minutes",
      time: "8:30",
      type: "orange" as const,
      icon: <Feather name="activity" size={24} color="#FF932D" />,
    },
    {
      id: 3,
      category: "Meal",
      name: "Prepare low salt lunch",
      time: "12:00",
      type: "red" as const,
      icon: <Ionicons name="restaurant-outline" size={26} color="#F15F5F" />,
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.homeScreen}>
          <View style={styles.homeHeader}>
            <View style={styles.homeHeaderTop}>
              <Image
                source={Images.logo_2}
                style={styles.homeLogo}
                resizeMode="contain"
              />

              <View style={styles.rightActions}>
                <Pressable
                  style={styles.notificationButton}
                  onPress={() => router.push("/notifications")}
                >
                  <Feather name="bell" size={20} color={colors.icon} />

                  {notificationCount > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {notificationCount > 99 ? "99+" : notificationCount}
                      </Text>
                    </View>
                  )}
                </Pressable>

                <Pressable
                  style={styles.iconButton}
                  onPress={() => router.push("/settings")}
                >
                  <Ionicons
                    name="settings-outline"
                    size={22}
                    color={colors.icon}
                  />
                </Pressable>
              </View>
            </View>

            <Pressable
              style={styles.greetingRow}
              onPress={() => router.push("/profile")}
            >
              <Ionicons
                name="person-circle"
                size={34}
                color={colors.icon}
                style={styles.greetingIcon}
              />
              <Text style={styles.greeting} numberOfLines={1}>
                Hello, {userName}
              </Text>
            </Pressable>

            <Text style={styles.subtitle}>
              Let’s keep track of your care today.
            </Text>
          </View>

          <ReminderCard
            title="Time to check your"
            highlight="Blood pressure"
            primaryText="Check Now"
            secondaryText="Remind Later"
          />

          <View style={styles.quickActionsRow}>
            <QuickActionCard
              bigTitle="CALL"
              smallTitle="Someone"
              variant="purple"
              icon={<Feather name="phone-call" size={28} color="#B6BCEB" />}
              onPress={() => router.push("/call")}
            />

            <QuickActionCard
              bigTitle="BOOKING"
              smallTitle="Manage"
              variant="mint"
              icon={<Feather name="calendar" size={28} color="#9FD3C7" />}
              onPress={() => router.push("/booking")}
            />
          </View>

          <View style={styles.taskHeader}>
            <Text style={styles.taskHeaderTitle}>Today’s Task</Text>

            <Pressable
              style={styles.taskAddBtn}
              onPress={() => router.push("/task")}
            >
              <Text style={styles.taskAddBtnText}>+</Text>
            </Pressable>
          </View>

          <View style={styles.taskList}>
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                category={task.category}
                name={task.name}
                time={task.time}
                type={task.type}
                icon={task.icon}
              />
            ))}
          </View>
        </View>
      </ScrollView>

      <BottomNav active="home" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  homeScreen: {
    paddingTop: 20,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
  homeHeader: {
    marginBottom: spacing.xxl,
  },
  homeHeaderTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  homeLogo: {
    width: 120,
    height: 36,
  },
  rightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  iconButton: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  notificationButton: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: "#F15F5F",
    justifyContent: "center",
    alignItems: "center",
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 12,
  },
  greetingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  greetingIcon: {
    marginRight: 8,
  },
  greeting: {
    flexShrink: 1,
    fontSize: 28,
    fontWeight: "700",
    color: colors.icon,
  },
  subtitle: {
    fontSize: 15,
    color: "#7B8794",
    lineHeight: 22,
    marginLeft: 42,
  },
  quickActionsRow: {
    flexDirection: "row",
    gap: spacing.lg,
    marginBottom: 72,
  },
  taskHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xxl,
  },
  taskHeaderTitle: {
    fontSize: 26,
    color: colors.icon,
    fontWeight: "600",
  },
  taskAddBtn: {
    width: 36,
    height: 36,
    backgroundColor: "#46576D",
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  taskAddBtnText: {
    color: colors.surface,
    fontSize: 24,
    lineHeight: 24,
  },
  taskList: {
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
});