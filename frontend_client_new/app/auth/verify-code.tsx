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

import PageHeader from "../../src/components/PageHeader";
import { authService } from "../../src/services/authService";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";

export default function VerifyCodeScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();

  const [digits, setDigits] = useState(["", "", "", "", ""]);
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
            <PageHeader title="Check your email" />

            <Text style={styles.pageDesc}>
              We sent a reset link to{" "}
              <Text style={styles.boldText}>
                {email || "contact@dscodetech.com"}
              </Text>
              {"\n"}
              enter 5 digit code that mentioned in the email
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

            <Pressable
              style={styles.primaryBtn}
              onPress={handleVerify}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={styles.primaryBtnText}>Verify Code</Text>
              )}
            </Pressable>

            <Text style={styles.resendText}>
              Haven’t got the email yet?{" "}
              <Text style={styles.inlineLink}>Resend email</Text>
            </Text>
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
    lineHeight: 26,
  },
  boldText: {
    fontWeight: "700",
    color: colors.textSecondary,
  },
  codeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.xxl,
  },
  codeBox: {
    width: 54,
    height: 54,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    backgroundColor: colors.surface,
    color: colors.textSecondary,
    fontSize: 22,
    fontWeight: "700",
  },
  codeBoxActive: {
    borderColor: colors.primary,
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
  },
  primaryBtnText: {
    ...typography.button,
  },
  resendText: {
    ...typography.subText,
    textAlign: "center",
    marginTop: spacing.xxl,
    fontSize: 16,
  },
  inlineLink: {
    color: colors.primary,
    textDecorationLine: "underline",
  },
});