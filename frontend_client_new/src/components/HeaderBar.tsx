import { View, Text, StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";

type HeaderBarProps = {
  userName: string;
};

export default function HeaderBar({ userName }: HeaderBarProps) {
  return (
    <View style={styles.headerBar}>
      <View style={styles.headerUser}>
        <View style={styles.userAvatarIcon}>
          <View style={styles.avatarHead} />
          <View style={styles.avatarBody} />
        </View>
        <Text style={styles.headerGreeting}>Hello, {userName}</Text>
      </View>

      <View style={styles.headerActions}>
        <Pressable onPress={() => router.push("./notifications")}>
          <Feather name="bell" size={24} color="#4B5B6B" />
        </Pressable>

        <Pressable onPress={() => router.push("./settings")}>
          <Feather name="settings" size={24} color="#4B5B6B" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 26,
  },
  headerUser: {
    flexDirection: "row",
    alignItems: "center",
  },
  userAvatarIcon: {
    width: 32,
    height: 32,
    borderWidth: 2,
    borderColor: "#5e6d7d",
    borderRadius: 16,
    position: "relative",
    marginRight: 10,
  },
  avatarHead: {
    position: "absolute",
    left: 10,
    top: 5,
    width: 8,
    height: 8,
    borderWidth: 2,
    borderColor: "#5e6d7d",
    borderRadius: 8,
  },
  avatarBody: {
    position: "absolute",
    left: 7,
    bottom: 5,
    width: 14,
    height: 7,
    borderWidth: 2,
    borderColor: "#5e6d7d",
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderBottomWidth: 0,
  },
  headerGreeting: {
    fontSize: 22,
    color: "#4b5b6b",
    fontWeight: "500",
  },
  headerActions: {
    flexDirection: "row",
    gap: 16,
  },
});