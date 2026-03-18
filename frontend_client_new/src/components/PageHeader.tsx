import { View, Text, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

type PageHeaderProps = {
  title: string;
  showBack?: boolean;
  rightSlot?: React.ReactNode;
};

export default function PageHeader({
  title,
  showBack = true,
  rightSlot,
}: PageHeaderProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.left}>
        {showBack && (
          <Pressable onPress={() => router.back()}>
            <Feather name="arrow-left" size={26} color={colors.icon} />
          </Pressable>
        )}

        <Text style={styles.title}>{title}</Text>
      </View>

      {rightSlot && <View>{rightSlot}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xxl,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  title: {
    ...typography.pageTitle,
  },
});