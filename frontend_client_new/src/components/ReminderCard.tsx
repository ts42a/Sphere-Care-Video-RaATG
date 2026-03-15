import { View, Text, StyleSheet, Pressable } from "react-native";

type ReminderCardProps = {
  title: string;
  highlight: string;
  primaryText: string;
  secondaryText: string;
};

export default function ReminderCard({
  title,
  highlight,
  primaryText,
  secondaryText,
}: ReminderCardProps) {
  return (
    <View style={styles.reminderCard}>
      <Text style={styles.reminderTitle}>
        {title}
        {"\n"}
        <Text style={styles.reminderHighlight}>{highlight}</Text>
      </Text>

      <View style={styles.reminderActions}>
        <Pressable style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>{primaryText}</Text>
        </Pressable>

        <Pressable style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>{secondaryText}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  reminderCard: {
    borderRadius: 24,
    paddingVertical: 24,
    paddingHorizontal: 20,
    marginBottom: 28,
    backgroundColor: "#e9eefb",
  },
  reminderTitle: {
    fontSize: 24,
    lineHeight: 30,
    color: "#647485",
    fontWeight: "300",
    marginBottom: 24,
  },
  reminderHighlight: {
    fontSize: 22,
    color: "#3f4f63",
    fontWeight: "700",
  },
  reminderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
  },
  primaryBtn: {
    backgroundColor: "#384959",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 28,
  },
  primaryBtnText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "500",
  },
  secondaryBtn: {
    paddingVertical: 8,
  },
  secondaryBtnText: {
    color: "#697889",
    fontSize: 16,
  },
});