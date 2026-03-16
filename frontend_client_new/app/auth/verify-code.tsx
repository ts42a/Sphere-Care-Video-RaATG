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

export default function VerifyCodeScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();

  const [digits, setDigits] = useState(["8", "6", "3", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function updateDigit(index: number, value: string) {
    const next = [...digits];
    next[index] = value.replace(/[^0-9]/g, "").slice(0, 1);
    setDigits(next);
  }

  async function handleVerify() {
    setError("");

    try {
      setLoading(true);
      const code = digits.join("");
      await authService.verifyCode(email || "", code);

      router.push({
        pathname: "/auth/set-password",
        params: { email: email || "" },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
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

        <Text style={styles.pageTitle}>Check your email</Text>
        <Text style={styles.pageDesc}>
          We sent a reset link to <Text style={styles.boldText}>{email || "contact@dscode...com"}</Text>
          {"\n"}enter 5 digit code that mentioned in the email
        </Text>

        <View style={styles.codeRow}>
          {digits.map((digit, index) => {
            const active = index < 3 || digit.length > 0;

            return (
              <TextInput
                key={index}
                style={[styles.codeBox, active && styles.codeBoxActive]}
                value={digit}
                onChangeText={(value) => updateDigit(index, value)}
                maxLength={1}
                keyboardType="number-pad"
                textAlign="center"
              />
            );
          })}
        </View>

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        <Pressable style={styles.primaryBtn} onPress={handleVerify} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryBtnText}>Verify Code</Text>
          )}
        </Pressable>

        <Text style={styles.resendText}>
          Haven’t got the email yet?{" "}
          <Text style={styles.inlineLink}>Resend email</Text>
        </Text>
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
    color: "#8F8F8F",
    marginBottom: 30,
    fontSize: 16,
    lineHeight: 28,
  },
  boldText: {
    fontWeight: "700",
    color: "#4B4B4B",
  },
  codeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 28,
  },
  codeBox: {
    width: 54,
    height: 54,
    borderWidth: 1.5,
    borderColor: "#D5D5D5",
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    color: "#526273",
    fontSize: 22,
    fontWeight: "700",
  },
  codeBoxActive: {
    borderColor: "#7C91DB",
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
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  resendText: {
    textAlign: "center",
    color: "#9A9A9A",
    marginTop: 28,
    fontSize: 16,
  },
  inlineLink: {
    color: "#6F85D8",
    textDecorationLine: "underline",
  },
});