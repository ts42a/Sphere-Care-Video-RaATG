import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";

type QuickActionCardProps = {
  bigTitle: string;
  smallTitle: string;
  variant: "purple" | "mint";
  icon: React.ReactNode;
  onPress?: () => void;
};

export default function QuickActionCard({
  bigTitle,
  smallTitle,
  variant,
  icon,
  onPress,
}: QuickActionCardProps) {
  return (
    <Pressable
      style={[
        styles.quickCard,
        variant === "purple" ? styles.quickCardPurple : styles.quickCardMint,
      ]}
      onPress={onPress}
    >
      <View style={styles.quickCardText}>
        <Text style={styles.quickSmallTitle}>{smallTitle}</Text>
        <Text style={styles.quickBigTitle}>{bigTitle}</Text>
      </View>

      <View style={styles.quickCardIcon}>{icon}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  quickCard: {
    flex: 1,
    minHeight: 94,
    borderRadius: 22,
    padding: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minWidth: 0,
  },
  quickCardPurple: {
    backgroundColor: "#E6E4FF",
  },
  quickCardMint: {
    backgroundColor: "#D8F2ED",
  },
  quickCardText: {
    flex: 1,
    gap: spacing.sm,
    minWidth: 0,
  },
  quickSmallTitle: {
    fontSize: 16,
    color: "#526273",
    lineHeight: 19,
  },
  quickBigTitle: {
    fontSize: 18,
    color: "#314152",
    fontWeight: "800",
    lineHeight: 20,
  },
  quickCardIcon: {
    marginLeft: 10,
    opacity: 0.45,
    alignItems: "center",
    justifyContent: "center",
  },
});