import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert, RefreshControl } from "react-native";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Stack, useFocusEffect } from "expo-router";

import PageHeader from "../../src/components/PageHeader";
import TaskCard, { type TaskType } from "../../src/components/TaskCard";
import { taskService } from "../../src/services/taskService";
import type { CareTask } from "../../src/types/task";
import {
  dateRangeForTaskFilter,
  formatTaskCategory,
  formatTaskTime,
  groupTasksByDate,
  shouldDimTask,
  sortTasksByTime,
  type TaskDateRange,
} from "../../src/utils/taskUtils";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";

type FilterType = "All" | "Completed" | string;

const RANGE_OPTIONS: Array<{ key: TaskDateRange; label: string }> = [
  { key: "today", label: "Today" },
  { key: "past3", label: "Past 3 days" },
  { key: "future3", label: "Future 3 days" },
];

function taskVisual(task: CareTask, dimmed = false): { type: TaskType; icon: ReactNode } {
  const taskType = task.taskType;
  const mutedColor = "#94A3B8";

  if (dimmed || task.status === "completed") {
    return { type: "gray", icon: <Feather name="check-circle" size={25} color={mutedColor} /> };
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
  const [activeRange, setActiveRange] = useState<TaskDateRange>("today");
  const [tasks, setTasks] = useState<CareTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clockTick, setClockTick] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setClockTick(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const loadTasks = useCallback(async (silent = false, range = activeRange) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const items = await taskService.getTasks(dateRangeForTaskFilter(range));
      setTasks(items);
    } catch (err: any) {
      setError(err?.message || "Could not load tasks.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeRange]);

  useFocusEffect(
    useCallback(() => {
      loadTasks(false, activeRange);
      const unsubscribe = taskService.subscribeRealtime(() => loadTasks(true, activeRange));
      return unsubscribe;
    }, [activeRange, loadTasks])
  );

  const filters = useMemo<FilterType[]>(() => {
    const categories = Array.from(
      new Set(
        tasks
          .filter((task) => task.status !== "cancelled")
          .map((task) => formatTaskCategory(task.taskType))
      )
    ).sort();

    return ["All", ...categories, "Completed"];
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let visible = tasks.filter((task) => task.status !== "cancelled");

    if (activeFilter === "Completed") {
      visible = visible.filter((task) => task.status === "completed");
    } else if (activeFilter !== "All") {
      visible = visible.filter(
        (task) => formatTaskCategory(task.taskType) === activeFilter && task.status !== "completed"
      );
    }

    return sortTasksByTime(visible);
  }, [activeFilter, tasks]);

  const groupedTasks = useMemo(
    () => groupTasksByDate(filteredTasks, activeRange),
    [activeRange, filteredTasks]
  );

  const todayCount = useMemo(
    () => tasks.filter((task) => task.status !== "completed" && task.status !== "cancelled").length,
    [tasks]
  );
  const completedCount = useMemo(
    () => tasks.filter((task) => task.status === "completed").length,
    [tasks]
  );

  const markComplete = useCallback(async (task: CareTask) => {
    try {
      const updated = await taskService.markCompleted(task.id);
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (err: any) {
      Alert.alert("Could not update task", err?.message || "Please try again.");
    }
  }, []);

  function renderTask(task: CareTask) {
    void clockTick;
    const dimmed = shouldDimTask(task, activeRange);
    const visual = taskVisual(task, dimmed);

    return (
      <TaskCard
        key={task.id}
        category={formatTaskCategory(task.taskType)}
        name={task.title}
        description={task.description}
        time={formatTaskTime(task.dueTime)}
        type={visual.type}
        icon={visual.icon}
        status={task.status}
        priority={task.priority}
        dimmed={dimmed}
        showCompletionControl={activeRange === "today"}
        onComplete={activeRange === "today" && task.status === "pending" ? () => markComplete(task) : undefined}
      />
    );
  }

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
              loadTasks(true, activeRange);
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
                <Text style={styles.statPill}>{todayCount} pending</Text>
                <Text style={styles.statPill}>{completedCount} completed</Text>
              </View>
            </View>
          </View>

          <View style={styles.sectionLabelRow}>
            <Text style={styles.sectionLabel}>Time range</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {RANGE_OPTIONS.map((option) => {
              const isActive = option.key === activeRange;
              return (
                <Pressable
                  key={option.key}
                  style={[styles.rangeBtn, isActive && styles.filterBtnActive]}
                  onPress={() => {
                    setActiveRange(option.key);
                    setActiveFilter("All");
                    loadTasks(false, option.key);
                  }}
                >
                  <Text style={[styles.filterBtnText, isActive && styles.filterBtnTextActive]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.sectionLabelRow}>
            <Text style={styles.sectionLabel}>Task type</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {filters.map((filter) => {
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
          ) : filteredTasks.length === 0 ? (
            <View style={styles.emptyCard}>
              <Feather name="check-circle" size={30} color="#22C55E" />
              <Text style={styles.emptyTitle}>No tasks here</Text>
              <Text style={styles.emptyText}>New doctor assigned activities will appear automatically.</Text>
            </View>
          ) : (
            <View style={styles.taskList}>
              {groupedTasks.map((group) => (
                <View key={group.label} style={styles.groupBlock}>
                  <Text style={styles.groupTitle}>{group.label}</Text>
                  <View style={styles.groupTasks}>{group.tasks.map(renderTask)}</View>
                </View>
              ))}
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
  sectionLabelRow: { marginTop: spacing.sm, marginBottom: 8 },
  sectionLabel: { color: "#64748B", fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  filterRow: { gap: spacing.md, paddingBottom: spacing.sm, marginBottom: spacing.md },
  filterBtn: { backgroundColor: "#F0F1F4", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 18 },
  rangeBtn: { backgroundColor: "#F0F1F4", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16 },
  filterBtnActive: { backgroundColor: "#46576D" },
  filterBtnText: { ...typography.body, color: "#526273", fontSize: 14, fontWeight: "700" },
  filterBtnTextActive: { color: "#FFFFFF" },
  loadingWrap: { paddingVertical: 40, alignItems: "center", gap: 10 },
  loadingText: { color: "#64748B", fontWeight: "600" },
  taskList: { gap: spacing.lg, paddingBottom: spacing.xxl },
  groupBlock: { gap: spacing.md },
  groupTitle: { fontSize: 15, color: colors.icon, fontWeight: "800", marginTop: 4 },
  groupTasks: { gap: spacing.lg },
  emptyCard: { backgroundColor: colors.surface, borderRadius: 22, padding: 20, alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border },
  emptyTitle: { ...typography.cardTitle, color: colors.icon, fontSize: 17 },
  emptyText: { ...typography.body, color: "#64748B", textAlign: "center", lineHeight: 20 },
  retryButton: { marginTop: 8, backgroundColor: colors.icon, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 9 },
  retryText: { color: "#FFFFFF", fontWeight: "700" },
});