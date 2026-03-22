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
import { router, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";

import PageHeader from "../../src/components/PageHeader";
import { authService } from "../../src/services/authService";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";

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

      router.push("./auth/password-reset-success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
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
            <PageHeader title="Set a new password" />

            <Text style={styles.pageDesc}>
              Create a new password. Ensure it differs from{"\n"}
              previous ones for security
            </Text>

            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                style={styles.passwordInput}
                placeholder="•••••••••••"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={secure1}
                value={password}
                onChangeText={setPassword}
              />
              <Pressable onPress={() => setSecure1((prev) => !prev)}>
                <Feather name="eye-off" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <Text style={styles.label}>Confirm Password</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                style={styles.passwordInput}
                placeholder="•••••••••••"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={secure2}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              <Pressable onPress={() => setSecure2((prev) => !prev)}>
                <Feather name="eye-off" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            {!!error && <Text style={styles.errorText}>{error}</Text>}

            <Pressable
              style={styles.primaryBtn}
              onPress={handleUpdatePassword}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={styles.primaryBtnText}>Update Password</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  screen: {
    flex: 1,
    paddingHorizontal: spacing.xxl,
    paddingTop: 32,
    paddingBottom: 40,
  },
  pageDesc: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing.xxxl,
    lineHeight: 28,
  },
  label: {
    ...typography.cardTitle,
    marginBottom: spacing.sm,
  },
  passwordWrap: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    height: 56,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    marginBottom: spacing.lg,
  },
  passwordInput: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 16,
    paddingRight: spacing.sm,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  primaryBtn: {
    width: "100%",
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  primaryBtnText: {
    ...typography.button,
  },
});