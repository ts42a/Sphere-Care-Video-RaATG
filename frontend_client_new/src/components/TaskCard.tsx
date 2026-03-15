import { View, Text, StyleSheet } from "react-native";
import React from "react";

type TaskType = "green" | "orange" | "red";

type TaskCardProps = {
  category: string;
  name: string;
  time: string;
  type: TaskType;
  icon: React.ReactNode;
};

export default function TaskCard({
  category,
  name,
  time,
  type,
  icon,
}: TaskCardProps) {
  return (
    <View
      style={[
        styles.taskCard,
        type === "orange" && styles.taskCardOrange,
        type === "red" && styles.taskCardRed,
      ]}
    >
      <View
        style={[
          styles.taskLeftLine,
          type === "green" && styles.taskLeftLineGreen,
          type === "orange" && styles.taskLeftLineOrange,
          type === "red" && styles.taskLeftLineRed,
        ]}
      />

      <View style={styles.taskIconBox}>{icon}</View>

      <View style={styles.taskContent}>
        <Text style={styles.taskCategory}>{category}</Text>
        <Text style={styles.taskName}>{name}</Text>
      </View>

      <Text
        style={[
          styles.taskTime,
          type === "green" && styles.taskTimeGreen,
          type === "orange" && styles.taskTimeOrange,
          type === "red" && styles.taskTimeRed,
        ]}
      >
        {time}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  taskCard: {
    position: "relative",
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    paddingVertical: 14,
    paddingLeft: 18,
    paddingRight: 16,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 96,
    borderWidth: 1,
    borderColor: "#EEF0F3",
  },
  taskCardOrange: {
    backgroundColor: "#FFF8F3",
    borderColor: "#FFE1CC",
  },
  taskCardRed: {
    backgroundColor: "#FFF7F7",
    borderColor: "#FFD8D8",
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
  taskIconBox: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "#F4F4F4",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  taskContent: {
    flex: 1,
  },
  taskCategory: {
    color: "#4D5C6D",
    fontSize: 16,
    marginBottom: 8,
  },
  taskName: {
    fontSize: 16,
    color: "#647485",
    fontWeight: "700",
    lineHeight: 21,
  },
  taskTime: {
    fontSize: 18,
    fontWeight: "700",
    marginLeft: 12,
  },
  taskTimeGreen: {
    color: "#27C27F",
  },
  taskTimeOrange: {
    color: "#FF932D",
  },
  taskTimeRed: {
    color: "#F15F5F",
  },
});