import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { authService } from "../../src/services/authService";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("contact@dscodetech.com");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleReset() {
    setError("");

    try {
      setLoading(true);
      const result = await authService.forgotPassword(email);

      router.push({
        pathname: "/auth/verify-code",
        params: { email: result.email },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.screen}>
            <Pressable style={styles.backBtn} onPress={() => router.back()}>
              <Feather name="arrow-left" size={28} color="#526273" />
            </Pressable>

            <Text style={styles.pageTitle}>Forgot password</Text>
            <Text style={styles.pageDesc}>
              Please enter your email to reset the password
            </Text>

            <Text style={styles.label}>Your Email</Text>

            <TextInput
              style={styles.input}
              placeholder="contact@dscodetech.com"
              placeholderTextColor="#6D7587"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
            />

            {!!error && <Text style={styles.errorText}>{error}</Text>}

            <Pressable
              style={styles.primaryBtn}
              onPress={handleReset}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryBtnText}>Reset Password</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F7F7" },
  scrollContent: { flexGrow: 1 },
  screen: { flex: 1, paddingHorizontal: 24, paddingTop: 56, paddingBottom: 40 },
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
    color: "#A0A0A0",
    marginBottom: 30,
    fontSize: 16,
    lineHeight: 24,
  },
  label: {
    color: "#1F2B3D",
    marginBottom: 10,
    fontSize: 18,
    fontWeight: "700",
  },
  input: {
    width: "100%",
    height: 58,
    borderWidth: 1.5,
    borderColor: "#D1D1D1",
    borderRadius: 14,
    paddingHorizontal: 16,
    backgroundColor: "transparent",
    color: "#526273",
    marginBottom: 18,
    fontSize: 16,
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