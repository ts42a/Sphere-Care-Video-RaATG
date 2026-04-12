import { View, Text, StyleSheet, Pressable } from "react-native";
import { Feather, MaterialIcons} from "@expo/vector-icons";

import { colors } from "../../theme/colors";
import { typography } from "../../theme/typography";

type CallHeaderProps = {
  time: string;
  aiEnabled: boolean;
  dark?: boolean;
  onBack: () => void;
  onMinimize?: () => void;
};

export default function CallHeader({
  time,
  aiEnabled,
  dark = false,
  onBack,
  onMinimize,
}: CallHeaderProps) {
  const iconColor = dark ? colors.surface : colors.icon;
  const timeColor = dark ? "#DCE3FF" : "#6C7482";
  const pillBg = dark ? "#DCE3FF" : "#EDEFFF";
  const pillText = dark ? "#3B4DA8" : "#4A5FC1";

  return (
    <View style={styles.wrapper}>
      <View style={styles.side}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Feather name="arrow-left" size={24} color={iconColor} />
        </Pressable>
      </View>

      <View pointerEvents="none" style={styles.center}>
        <Text style={[styles.time, { color: timeColor }]}>{time}</Text>
      </View>

      <View style={[styles.side, styles.right]}>
        <View style={styles.rightInner}>
            {onMinimize ? (
            <Pressable style={styles.minBtn} onPress={onMinimize}>
                <MaterialIcons name="picture-in-picture-alt" size={18} color={iconColor} />
            </Pressable>
            ) : null}

            <View style={[styles.aiPill, { backgroundColor: pillBg }]}>
            <Text style={[styles.aiText, { color: pillText }]}>
                {aiEnabled ? "AI On" : "AI Off"}
            </Text>
            </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 36,
  },
  side: {
    width: 80,
    justifyContent: "center",
  },
  right: {
    alignItems: "flex-end",
  },
  center: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  backBtn: {
    width: 32,
    height: 32,
    justifyContent: "center",
  },
  time: {
    ...typography.body,
    fontSize: 15,
    textAlign: "center",
  },
  aiPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  aiText: {
    fontSize: 12,
    fontWeight: "700",
  },
  rightInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  minBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.08)",
  },
});