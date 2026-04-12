import { View, Text, StyleSheet, Pressable, type ReactNode } from "react-native";
import { colors } from "../../theme/colors";

export type CallControlItem = {
  key: string;
  label: string;
  icon: ReactNode;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
};

type CallControlsProps = {
  items: CallControlItem[];
  layout?: "grid" | "row";
};

export default function CallControls({
  items,
  layout = "row",
}: CallControlsProps) {
  return (
    <View style={layout === "grid" ? styles.gridWrap : styles.rowWrap}>
      {items.map((item) => {
        const isGrid = layout === "grid";

        return (
            <View
            key={item.key}
            style={isGrid ? styles.gridItemWrap : styles.rowItemWrap}
            >
            <Pressable
                onPress={item.onPress}
                style={[
                isGrid ? styles.gridButton : styles.rowButton,
                item.active ? styles.activeButton : null,
                item.danger
                    ? isGrid
                    ? styles.gridDangerButton
                    : styles.rowDangerButton
                    : null,
                ]}
            >
                {item.icon}

                {isGrid && item.label ? (
                <Text style={[styles.gridLabel, item.danger ? styles.gridDangerLabel : null]}>
                    {item.label}
                </Text>
                ) : null}
            </Pressable>

            {!isGrid && item.label ? (
                <Text
                style={[
                    styles.rowLabel,
                    item.danger ? styles.rowDangerLabel : null,
                ]}
                >
                {item.label}
                </Text>
            ) : null}
            </View>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  gridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 10,
  },
  rowWrap: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  gridItemWrap: {
    width: "48%",
    alignItems: "center",
  },
  rowItemWrap: {
    alignItems: "center",
  },
  gridButton: {
    width: "100%",
    minHeight: 72,
    backgroundColor: colors.surface,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  activeButton: {
    backgroundColor: "#EDEFFF",
    borderColor: "#D9DFFF",
  },
  gridDangerButton: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  rowDangerButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.danger,
  },
  gridLabel: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  rowLabel: {
    color: "#DCE3FF",
    fontSize: 13,
    fontWeight: "600",
  },
  rowDangerLabel: {
    color: "#DCE3FF",
  },
  gridDangerLabel: {
    color: colors.surface,
  },
});