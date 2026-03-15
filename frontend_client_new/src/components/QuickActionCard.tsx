import { View, Text, StyleSheet, Pressable } from "react-native";

type QuickActionCardProps = {
  bigTitle: string
  smallTitle: string
  variant: "purple" | "mint"
  icon: React.ReactNode
  onPress?: () => void
}

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
      <Text style={styles.quickCardIcon}>{icon}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  quickCard: {
    flex: 1,
    minHeight: 94,
    borderRadius: 22,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  quickCardPurple: {
    backgroundColor: "#e6e4ff",
  },
  quickCardMint: {
    backgroundColor: "#d8f2ed",
  },
  quickCardText: {
    flex: 1,
    gap: 8,
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
    fontSize: 28,
    opacity: 0.45,
    marginLeft: 10,
  },
});