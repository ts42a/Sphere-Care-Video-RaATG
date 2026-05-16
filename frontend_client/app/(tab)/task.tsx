import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert, RefreshControl } from "react-native";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Stack, useFocusEffect } from "expo-router";

import PageHeader from "../../src/components/PageHeader";
import TaskCard, { type TaskType } from "../../src/components/TaskCard";
import { taskService } from "../../src/services/taskService";
import type { CareTask } from "../../src/types/task";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";

type FilterType = "All" | "Medication" | "Exercise" | "Meal" | "Activity" | "Completed";

const FILTERS: FilterType[] = ["All", "Medication", "Exercise", "Meal", "Activity", "Completed"];

function isToday(value?: string | null) {
  if (!value) return false;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return value === today;
}

function formatTime(value?: string | null) {
  if (!value) return "Any time";
  return String(value).slice(0, 5);
}

function formatCategory(value: string) {
  const normalized = value || "activity";
  if (["meal_support", "meal"].includes(normalized)) return "Meal";
  if (["mobility", "mobility_assist", "exercise"].includes(normalized)) return "Exercise";
  if (normalized === "medication") return "Medication";
  if (normalized === "doctor_followup") return "Follow up";
  if (normalized === "wellness_check") return "Wellness";
  return normalized.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function taskVisual(task: CareTask): { type: TaskType; icon: ReactNode } {
  const taskType = task.taskType;
  if (task.status === "completed") {
    return { type: "gray", icon: <Feather name="check-circle" size={25} color="#64748B" /> };
  }
  if (task.priority === "urgent" || task.priority === "high") {
    return { type: "red", icon: <Feather name="alert-circle" size={25} color="#F15F5F" /> };
  }
  if (taskType === "medication") {
    return { type: "green", icon: <Ionicons name="medical-outline" size={26} color="#27C27F" /> };
  }
  if (["exercise", "mobility", "mobility_assist"].includes(taskType)) {
    return { type: "orange", icon: <Feather name="activity" size={24} color="#FF932D" /> };
  }
  if (["meal", "meal_support", "hydration"].includes(taskType)) {
    return { type: "red", icon: <Ionicons name="restaurant-outline" size={26} color="#F15F5F" /> };
  }
  if (taskType === "doctor_followup") {
    return { type: "blue", icon: <MaterialCommunityIcons name="stethoscope" size={25} color="#4F7DF3" /> };
  }
  return { type: "blue", icon: <Feather name="calendar" size={24} color="#4F7DF3" /> };
}

export default function TaskScreen() {
  const [activeFilter, setActiveFilter] = useState<FilterType>("All");
  const [tasks, setTasks] = useState<CareTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const items = await taskService.getTasks();
      setTasks(items);
    } catch (err: any) {
      setError(err?.message || "Could not load tasks.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTasks();
      const unsubscribe = taskService.subscribeRealtime(() => loadTasks(true));
      return unsubscribe;
    }, [loadTasks])
  );

  const filteredTasks = useMemo(() => {
    if (activeFilter === "All") return tasks.filter((task) => task.status !== "cancelled");
    if (activeFilter === "Completed") return tasks.filter((task) => task.status === "completed");
    return tasks.filter((task) => formatCategory(task.taskType) === activeFilter && task.status !== "cancelled");
  }, [activeFilter, tasks]);

  const todayCount = useMemo(() => tasks.filter((task) => isToday(task.dueDate) && task.status !== "completed" && task.status !== "cancelled").length, [tasks]);
  const completedCount = useMemo(() => tasks.filter((task) => task.status === "completed").length, [tasks]);

  const markComplete = useCallback(async (task: CareTask) => {
    try {
      const updated = await taskService.markCompleted(task.id);
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (err: any) {
      Alert.alert("Could not update task", err?.message || "Please try again.");
    }
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadTasks(true);
            }}
          />
        }
      >
        <View style={styles.screen}>
          <PageHeader title="Task" showBack={false} />

          <View style={styles.summaryCard}>
            <View style={styles.summaryIconWrap}>
              <Feather name="clipboard" size={24} color={colors.surface} />
            </View>
            <View style={styles.summaryContent}>
              <Text style={styles.summaryTitle}>Care plan tasks</Text>
              <Text style={styles.summaryText}>
                Tasks assigned by your doctor or care team will appear here in real time.
              </Text>
              <View style={styles.statsRow}>
                <Text style={styles.statPill}>{todayCount} today</Text>
                <Text style={styles.statPill}>{completedCount} completed</Text>
              </View>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {FILTERS.map((filter) => {
              const isActive = filter === activeFilter;
              return (
                <Pressable key={filter} style={[styles.filterBtn, isActive && styles.filterBtnActive]} onPress={() => setActiveFilter(filter)}>
                  <Text style={[styles.filterBtnText, isActive && styles.filterBtnTextActive]}>{filter}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Loading tasks…</Text>
            </View>
          ) : error ? (
            <View style={styles.emptyCard}>
              <Feather name="alert-circle" size={26} color="#EF4444" />
              <Text style={styles.emptyTitle}>Task list unavailable</Text>
              <Text style={styles.emptyText}>{error}</Text>
              <Pressable style={styles.retryButton} onPress={() => loadTasks()}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.taskList}>
              {filteredTasks.map((task) => {
                const visual = taskVisual(task);
                return (
                  <TaskCard
                    key={task.id}
                    category={formatCategory(task.taskType)}
                    name={task.title}
                    description={task.description}
                    time={formatTime(task.dueTime)}
                    type={visual.type}
                    icon={visual.icon}
                    status={task.status}
                    priority={task.priority}
                    onComplete={() => markComplete(task)}
                  />
                );
              })}
            </View>
          )}

          {!loading && !error && filteredTasks.length === 0 && (
            <View style={styles.emptyCard}>
              <Feather name="check-circle" size={30} color="#22C55E" />
              <Text style={styles.emptyTitle}>No tasks here</Text>
              <Text style={styles.emptyText}>New doctor assigned activities will appear automatically.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
  screen: { paddingTop: spacing.xxl, paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
  summaryCard: {
    backgroundColor: "#E9EEFB",
    borderRadius: 24,
    padding: spacing.lg + 2,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  summaryIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: colors.icon,
    justifyContent: "center",
    alignItems: "center",
  },
  summaryContent: { flex: 1 },
  summaryTitle: { ...typography.cardTitle, color: colors.icon, fontSize: 18, marginBottom: 4 },
  summaryText: { ...typography.body, color: "#526273", lineHeight: 20, fontSize: 14 },
  statsRow: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  statPill: { backgroundColor: "rgba(255,255,255,0.75)", color: colors.icon, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, fontWeight: "700", overflow: "hidden" },
  filterRow: { gap: spacing.md, paddingBottom: spacing.sm, marginBottom: spacing.lg },
  filterBtn: { backgroundColor: "#F0F1F4", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 18 },
  filterBtnActive: { backgroundColor: "#46576D" },
  filterBtnText: { ...typography.body, color: "#526273", fontSize: 15, fontWeight: "500" },
  filterBtnTextActive: { color: colors.surface },
  taskList: { gap: spacing.lg, paddingBottom: spacing.xl },
  loadingWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 48 },
  loadingText: { marginTop: 12, color: "#64748B", fontWeight: "600" },
  emptyCard: { backgroundColor: colors.surface, borderRadius: 22, padding: 24, alignItems: "center", borderWidth: 1, borderColor: colors.border, gap: 8 },
  emptyTitle: { ...typography.cardTitle, color: "#334155", fontSize: 17 },
  emptyText: { ...typography.body, color: "#64748B", textAlign: "center", lineHeight: 20 },
  retryButton: { marginTop: 8, backgroundColor: colors.icon, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  retryText: { color: colors.surface, fontWeight: "700" },
});