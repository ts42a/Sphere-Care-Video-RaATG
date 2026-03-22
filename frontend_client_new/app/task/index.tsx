import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";

import PageHeader from "../../src/components/PageHeader";
import TaskCard from "../../src/components/TaskCard";
import BottomNav from "../../src/components/BottomNav";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";

type FilterType = "All" | "Medication" | "Exercise" | "Meal";

export default function TaskScreen() {
  const [activeFilter, setActiveFilter] = useState<FilterType>("All");

  const filters: FilterType[] = ["All", "Medication", "Exercise", "Meal"];

  const tasks = [
    {
      id: 1,
      category: "Medication",
      name: "Vitamin D 1000 IU after breakfast",
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
    {
      id: 4,
      category: "Medication",
      name: "Blood pressure tablet after dinner",
      time: "19:00",
      type: "green" as const,
      icon: <Ionicons name="medical-outline" size={26} color="#27C27F" />,
    },
  ];

  const filteredTasks = useMemo(() => {
    if (activeFilter === "All") {
      return tasks;
    }

    return tasks.filter((task) => task.category === activeFilter);
  }, [activeFilter]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.screen}>
          <PageHeader title="Task" />

          <View style={styles.aiCard}>
            <View style={styles.aiIconWrap}>
              <Text style={styles.aiIconText}>AI</Text>
            </View>

            <View style={styles.aiContent}>
              <Text style={styles.aiText}>
                Need help planning today’s tasks and reminders?
              </Text>

              <Pressable>
                <Text style={styles.aiLink}>Ask AI assistant</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {filters.map((filter) => {
              const isActive = filter === activeFilter;

              return (
                <Pressable
                  key={filter}
                  style={[
                    styles.filterBtn,
                    isActive && styles.filterBtnActive,
                  ]}
                  onPress={() => setActiveFilter(filter)}
                >
                  <Text
                    style={[
                      styles.filterBtnText,
                      isActive && styles.filterBtnTextActive,
                    ]}
                  >
                    {filter}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.taskList}>
            {filteredTasks.map((task) => (
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

          {filteredTasks.length === 0 && (
            <Text style={styles.emptyText}>No tasks in this category.</Text>
          )}
        </View>
      </ScrollView>

      <BottomNav active="task" />
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
  screen: {
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
  aiCard: {
    backgroundColor: "#E9EEFB",
    borderRadius: 22,
    padding: spacing.lg + 2,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  aiIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: colors.icon,
    justifyContent: "center",
    alignItems: "center",
  },
  aiIconText: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.icon,
  },
  aiContent: {
    flex: 1,
  },
  aiText: {
    ...typography.body,
    color: colors.icon,
    lineHeight: 21,
    marginBottom: spacing.sm,
    fontSize: 15,
  },
  aiLink: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FF8A2B",
  },
  filterRow: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
    marginBottom: spacing.lg,
  },
  filterBtn: {
    backgroundColor: "#F0F1F4",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  filterBtnActive: {
    backgroundColor: "#46576D",
  },
  filterBtnText: {
    ...typography.body,
    color: "#526273",
    fontSize: 15,
    fontWeight: "500",
  },
  filterBtnTextActive: {
    color: colors.surface,
  },
  taskList: {
    gap: spacing.lg,
    paddingBottom: spacing.xl,
  },
  emptyText: {
    marginTop: spacing.sm,
    fontSize: 15,
    color: "#7B8794",
    textAlign: "center",
  },
});