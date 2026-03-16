import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";

export default function PasswordResetSuccessScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.screen}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={28} color="#526273" />
        </Pressable>

        <Text style={styles.pageTitle}>Password reset</Text>
        <Text style={styles.pageDesc}>
          Your password has been successfully reset. click{"\n"}
          confirm to set a new password
        </Text>

        <Pressable style={styles.primaryBtn} onPress={() => router.replace("/auth/login")}>
          <Text style={styles.primaryBtnText}>Confirm</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F7F7" },
  screen: { flex: 1, paddingHorizontal: 20, paddingTop: 56 },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#EFEFEF",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
    marginBottom: 28,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#222222",
    marginBottom: 10,
  },
  pageDesc: {
    color: "#989898",
    marginBottom: 30,
    fontSize: 16,
    lineHeight: 30,
  },
  primaryBtn: {
    width: "100%",
    height: 58,
    borderRadius: 14,
    backgroundColor: "#7C91DB",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
});