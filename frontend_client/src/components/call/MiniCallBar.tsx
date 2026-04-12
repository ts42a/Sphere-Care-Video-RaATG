import { Pressable, View, Text, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Feather, MaterialIcons } from "@expo/vector-icons";

import { useMiniCall } from "../../hooks/useMiniCall";
import { miniCallService } from "../../services/miniCallService";
import { colors } from "../../theme/colors";

export default function MiniCallBar() {
  const miniCall = useMiniCall();

  if (
    !miniCall.active ||
    !miniCall.minimized ||
    !miniCall.contactId ||
    !miniCall.mode
  ) {
    return null;
  }

  function reopenCall() {
    miniCallService.setState({ minimized: false });

    router.push({
      pathname:
        miniCall.mode === "video"
          ? "/call/video/[contactId]"
          : "/call/audio/[contactId]",
      params: { contactId: miniCall.contactId },
    });
  }

  return (
    <Pressable style={styles.container} onPress={reopenCall}>
      <View style={styles.left}>
        <View style={styles.liveDot} />
        <View>
          <Text style={styles.title}>{miniCall.contactName || "Active call"}</Text>
          <Text style={styles.subtitle}>
            {miniCall.mode === "video" ? "Video call in progress" : "Audio call in progress"}
          </Text>
        </View>
      </View>

      <View style={styles.right}>
        {miniCall.mode === "video" ? (
          <Feather name="video" size={20} color={colors.surface} />
        ) : (
          <Feather name="phone" size={20} color={colors.surface} />
        )}

        <MaterialIcons name="open-in-full" size={20} color={colors.surface} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 16,
    backgroundColor: "#203A6B",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
  },
  title: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "700",
  },
  subtitle: {
    color: "#DCE3FF",
    fontSize: 12,
    marginTop: 2,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
});