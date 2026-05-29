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
  dimmed?: boolean;
  onPress?: () => void;
  onComplete?: () => void;
  showCompletionControl?: boolean;
};

function getTimeStyle(type: TaskType, dimmed?: boolean) {
  if (dimmed) return styles.taskTimeDimmed;

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
  dimmed = false,
  onPress,
  onComplete,
  showCompletionControl = true,
}: TaskCardProps) {
  const completed = status === "completed";
  const muted = dimmed || completed;

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
        muted && styles.taskCardMuted,
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
          muted && styles.taskLeftLineMuted,
        ]}
      />

      <View style={[styles.taskIconBox, muted && styles.taskIconBoxMuted]}>
        <View style={muted && styles.iconMuted}>{icon}</View>
      </View>

      <View style={styles.taskContent}>
        <View style={styles.metaRow}>
          <Text style={[styles.taskCategory, muted && styles.mutedText]}>{category}</Text>
          {priority && priority !== "medium" ? (
            <Text style={[styles.priorityPill, priority === "urgent" && styles.priorityUrgent, muted && styles.priorityMuted]}>
              {priority.toUpperCase()}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.taskName, completed && styles.completedText, muted && !completed && styles.mutedTitle]}>{name}</Text>
        {description ? <Text style={[styles.description, muted && styles.mutedText]} numberOfLines={2}>{description}</Text> : null}
        <View style={styles.footerRow}>
          <Text style={[styles.statusText, muted && styles.mutedText]}>{statusLabel(status)}</Text>
          <Text style={styles.dot}>•</Text>
          <Text style={[styles.taskTime, getTimeStyle(type, muted)]}>
            {time || "Any time"}
          </Text>
        </View>
      </View>

      {showCompletionControl && onComplete && !completed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mark task as completed"
          style={[styles.pendingButton, muted && styles.pendingButtonMuted]}
          onPress={onComplete}
        />
      ) : showCompletionControl && completed ? (
        <View style={styles.completedIcon}>
          <Feather name="check" size={14} color="#FFFFFF" />
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
  taskCardMuted: {
    backgroundColor: "#F5F6F8",
    borderColor: "#E2E8F0",
    opacity: 0.68,
  },
  taskLeftLine: {
    position: "absolute",
    left: 0,
    top: 16,
    bottom: 16,
    width: 4,
    borderRadius: 8,
  },
  taskLeftLineGreen: { backgroundColor: "#27C27F" },
  taskLeftLineOrange: { backgroundColor: "#FF932D" },
  taskLeftLineRed: { backgroundColor: "#F15F5F" },
  taskLeftLineBlue: { backgroundColor: "#4F7DF3" },
  taskLeftLineGray: { backgroundColor: "#94A3B8" },
  taskLeftLineMuted: { backgroundColor: "#94A3B8" },
  taskIconBox: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "#F4F4F4",
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.lg,
  },
  taskIconBoxMuted: {
    backgroundColor: "#E8EDF3",
  },
  iconMuted: {
    opacity: 0.55,
  },
  taskContent: { flex: 1 },
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
  priorityMuted: {
    color: "#64748B",
    backgroundColor: "#E2E8F0",
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
  mutedTitle: {
    color: "#64748B",
  },
  description: {
    marginTop: 4,
    color: "#64748B",
    fontSize: 13,
    lineHeight: 18,
  },
  mutedText: {
    color: "#94A3B8",
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
  dot: { color: "#CBD5E1" },
  taskTime: {
    fontSize: 13,
    fontWeight: "800",
  },
  taskTimeGreen: { color: "#27C27F" },
  taskTimeOrange: { color: "#FF932D" },
  taskTimeRed: { color: "#F15F5F" },
  taskTimeBlue: { color: "#4F7DF3" },
  taskTimeGray: { color: "#64748B" },
  taskTimeDimmed: { color: "#94A3B8" },
  pendingButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#ababab",
    backgroundColor: "transparent",
    marginLeft: 10,
  },
  pendingButtonMuted: {
    borderColor: "#CBD5E1",
  },
  completedIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#4B5563",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 10,
  },
});