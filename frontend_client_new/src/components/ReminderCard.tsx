import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

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
    marginBottom: spacing.xxxl,
    backgroundColor: "#E9EEFB",
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
    color: "#3F4F63",
    fontWeight: "700",
  },
  reminderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    flexWrap: "wrap",
  },
  primaryBtn: {
    backgroundColor: "#384959",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 28,
  },
  primaryBtnText: {
    color: colors.surface,
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