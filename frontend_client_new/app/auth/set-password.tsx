import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { authService } from "../../src/services/authService";

export default function SetPasswordScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();

  const [password, setPassword] = useState("•••••••••••");
  const [confirmPassword, setConfirmPassword] = useState("•••••••••••");
  const [secure1, setSecure1] = useState(true);
  const [secure2, setSecure2] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleUpdatePassword() {
    setError("");

    try {
      setLoading(true);
      await authService.resetPassword({
        email: email || "",
        password,
        confirmPassword,
      });

      router.push("/auth/password-reset");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.screen}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={28} color="#526273" />
        </Pressable>

        <Text style={styles.pageTitle}>Set a new password</Text>
        <Text style={styles.pageDesc}>
          Create a new password. Ensure it differs from{"\n"}
          previous ones for security
        </Text>

        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordWrap}>
          <TextInput
            style={styles.passwordInput}
            placeholder="•••••••••••"
            placeholderTextColor="#526273"
            secureTextEntry={secure1}
            value={password}
            onChangeText={setPassword}
          />
          <Pressable onPress={() => setSecure1((prev) => !prev)}>
            <Feather name="eye-off" size={22} color="#C8C8C8" />
          </Pressable>
        </View>

        <Text style={styles.label}>Confirm Password</Text>
        <View style={styles.passwordWrap}>
          <TextInput
            style={styles.passwordInput}
            placeholder="•••••••••••"
            placeholderTextColor="#526273"
            secureTextEntry={secure2}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />
          <Pressable onPress={() => setSecure2((prev) => !prev)}>
            <Feather name="eye-off" size={22} color="#C8C8C8" />
          </Pressable>
        </View>

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        <Pressable
          style={styles.primaryBtn}
          onPress={handleUpdatePassword}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryBtnText}>Update Password</Text>
          )}
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
  label: {
    color: "#1F2B3D",
    marginBottom: 10,
    fontSize: 18,
    fontWeight: "700",
  },
  passwordWrap: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    height: 58,
    borderWidth: 1.5,
    borderColor: "#D1D1D1",
    borderRadius: 14,
    paddingHorizontal: 16,
    marginBottom: 18,
  },
  passwordInput: {
    flex: 1,
    color: "#526273",
    fontSize: 16,
    paddingRight: 12,
  },
  errorText: {
    color: "#D9534F",
    fontSize: 14,
    marginBottom: 8,
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