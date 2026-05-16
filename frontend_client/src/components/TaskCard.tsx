import { View, Text, StyleSheet, Pressable } from "react-native";
import React from "react";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

export type TaskType = "green" | "orange" | "red" | "blue" | "gray";

type TaskCardProps = {
  category: string;
  name: string;
  time: string;
  type: TaskType;
  icon: React.ReactNode;
  description?: string | null;
  status?: string;
  priority?: string;
  onPress?: () => void;
  onComplete?: () => void;
};

function getTimeStyle(type: TaskType) {
  switch (type) {
    case "orange": return styles.taskTimeOrange;
    case "red": return styles.taskTimeRed;
    case "blue": return styles.taskTimeBlue;
    case "gray": return styles.taskTimeGray;
    default: return styles.taskTimeGreen;
  }
}

function statusLabel(status?: string) {
  if (!status) return "Pending";
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function TaskCard({
  category,
  name,
  time,
  type,
  icon,
  description,
  status = "pending",
  priority,
  onPress,
  onComplete,
}: TaskCardProps) {
  const completed = status === "completed";

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={[
        styles.taskCard,
        type === "orange" && styles.taskCardOrange,
        type === "red" && styles.taskCardRed,
        type === "blue" && styles.taskCardBlue,
        type === "gray" && styles.taskCardGray,
        completed && styles.taskCardCompleted,
      ]}
    >
      <View
        style={[
          styles.taskLeftLine,
          type === "green" && styles.taskLeftLineGreen,
          type === "orange" && styles.taskLeftLineOrange,
          type === "red" && styles.taskLeftLineRed,
          type === "blue" && styles.taskLeftLineBlue,
          type === "gray" && styles.taskLeftLineGray,
        ]}
      />

      <View style={styles.taskIconBox}>{icon}</View>

      <View style={styles.taskContent}>
        <View style={styles.metaRow}>
          <Text style={styles.taskCategory}>{category}</Text>
          {priority && priority !== "medium" ? (
            <Text style={[styles.priorityPill, priority === "urgent" && styles.priorityUrgent]}>
              {priority.toUpperCase()}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.taskName, completed && styles.completedText]}>{name}</Text>
        {description ? <Text style={styles.description} numberOfLines={2}>{description}</Text> : null}
        <View style={styles.footerRow}>
          <Text style={styles.statusText}>{statusLabel(status)}</Text>
          <Text style={styles.dot}>•</Text>
          <Text style={[styles.taskTime, getTimeStyle(type)]}>
            {time || "Any time"}
          </Text>
        </View>
      </View>

      {onComplete && !completed ? (
        <Pressable style={styles.completeButton} onPress={onComplete}>
          <Feather name="check" size={18} color="#FFFFFF" />
        </Pressable>
      ) : completed ? (
        <View style={styles.completedIcon}>
          <Feather name="check" size={18} color="#FFFFFF" />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  taskCard: {
    position: "relative",
    backgroundColor: colors.surface,
    borderRadius: 22,
    paddingVertical: 14,
    paddingLeft: 18,
    paddingRight: 14,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 104,
    borderWidth: 1,
    borderColor: colors.border,
  },
  taskCardOrange: {
    backgroundColor: "#FFF8F3",
    borderColor: "#FFE1CC",
  },
  taskCardRed: {
    backgroundColor: "#FFF7F7",
    borderColor: "#FFD8D8",
  },
  taskCardBlue: {
    backgroundColor: "#F4F7FF",
    borderColor: "#DDE7FF",
  },
  taskCardGray: {
    backgroundColor: "#F8FAFC",
    borderColor: "#E5E7EB",
  },
  taskCardCompleted: {
    opacity: 0.72,
  },
  taskLeftLine: {
    position: "absolute",
    left: 0,
    top: 16,
    bottom: 16,
    width: 4,
    borderRadius: 8,
  },
  taskLeftLineGreen: {
    backgroundColor: "#27C27F",
  },
  taskLeftLineOrange: {
    backgroundColor: "#FF932D",
  },
  taskLeftLineRed: {
    backgroundColor: "#F15F5F",
  },
  taskLeftLineBlue: {
    backgroundColor: "#4F7DF3",
  },
  taskLeftLineGray: {
    backgroundColor: "#94A3B8",
  },
  taskIconBox: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "#F4F4F4",
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.lg,
  },
  taskContent: {
    flex: 1,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  taskCategory: {
    ...typography.body,
    color: "#4D5C6D",
    fontSize: 14,
    fontWeight: "700",
  },
  priorityPill: {
    fontSize: 10,
    fontWeight: "800",
    color: "#B45309",
    backgroundColor: "#FEF3C7",
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: "hidden",
  },
  priorityUrgent: {
    color: "#B91C1C",
    backgroundColor: "#FEE2E2",
  },
  taskName: {
    ...typography.cardTitle,
    color: "#334155",
    fontSize: 16,
    lineHeight: 21,
  },
  completedText: {
    textDecorationLine: "line-through",
    color: "#64748B",
  },
  description: {
    marginTop: 4,
    color: "#64748B",
    fontSize: 13,
    lineHeight: 18,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748B",
  },
  dot: {
    color: "#CBD5E1",
  },
  taskTime: {
    fontSize: 13,
    fontWeight: "800",
  },
  taskTimeGreen: { color: "#27C27F" },
  taskTimeOrange: { color: "#FF932D" },
  taskTimeRed: { color: "#F15F5F" },
  taskTimeBlue: { color: "#4F7DF3" },
  taskTimeGray: { color: "#64748B" },
  completeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#22C55E",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 10,
  },
  completedIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#94A3B8",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 10,
  },
});