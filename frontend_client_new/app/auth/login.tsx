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
  Image,
} from "react-native";
import { router } from "expo-router";
import { Images } from "../../src/constants/images";
import { authService } from "../../src/services/authService";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";

export default function LoginScreen() {
  const [email, setEmail] = useState("johnsmith@gmail.com");
  const [password, setPassword] = useState("XXXXXXXXXXX");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError("");

    if (!email || !password) {
      setError("Please enter your email and password");
      return;
    }

    try {
      setLoading(true);
      await authService.login(email, password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
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
            <View style={styles.logoWrap}>
              <Image
                source={Images.logo_2}
                style={{ width: 250, height: 60, resizeMode: "contain" }}
              />
            </View>

            <Text style={styles.title}>Login</Text>
            <Text style={styles.subtitle}>
              Enter your email and password{"\n"}to login
            </Text>

            <View style={styles.form}>
              <TextInput
                style={styles.input}
                placeholder="Enter your Email here"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
              />

              <TextInput
                style={styles.input}
                placeholder="Enter your password here"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />

              {!!error && <Text style={styles.errorText}>{error}</Text>}

              <Pressable
                style={styles.forgotWrap}
                onPress={() => router.push("/auth/forgot-password")}
              >
                <Text style={styles.forgotText}>Forgot Password?</Text>
              </Pressable>

              <Pressable
                style={styles.primaryBtn}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={colors.surface} />
                ) : (
                  <Text style={styles.primaryBtnText}>Login</Text>
                )}
              </Pressable>
            </View>

            <Text style={styles.dividerText}>Or login in with</Text>

            <View style={styles.socialRow}>
              <Pressable style={[styles.socialBtn, styles.googleBtn]}>
                <Text style={styles.googleIcon}>G</Text>
                <Text style={styles.googleText}>Google</Text>
              </Pressable>

              <Pressable style={[styles.socialBtn, styles.facebookBtn]}>
                <Text style={styles.facebookIcon}>f</Text>
                <Text style={styles.facebookText}>Facebook</Text>
              </Pressable>
            </View>

            <View style={styles.bottomTextRow}>
              <Text style={styles.bottomText}>Don't have an account? </Text>
              <Pressable onPress={() => router.push("/auth/register")}>
                <Text style={styles.inlineLink}>Register</Text>
              </Pressable>
            </View>
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
    paddingHorizontal: spacing.xxxl,
    paddingTop: 48,
    paddingBottom: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  logoWrap: {
    marginBottom: spacing.xxxl,
    alignItems: "center",
  },
  logoBox: {
    width: 96,
    height: 72,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  logoPlaceholder: {
    ...typography.cardTitle,
    color: colors.icon,
  },
  title: {
    ...typography.pageTitle,
    marginBottom: spacing.md,
  },
  subtitle: {
    ...typography.body,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: spacing.xxxl,
  },
  form: {
    width: "100%",
  },
  input: {
    width: "100%",
    height: 56,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    fontSize: 16,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    marginTop: -4,
    marginBottom: spacing.sm,
  },
  forgotWrap: {
    width: "100%",
    alignItems: "flex-end",
    marginTop: -4,
    marginBottom: spacing.lg,
  },
  forgotText: {
    ...typography.subText,
    color: colors.textSecondary,
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
  dividerText: {
    ...typography.subText,
    marginTop: spacing.xxl,
    marginBottom: spacing.xl,
    textAlign: "center",
  },
  socialRow: {
    flexDirection: "row",
    gap: spacing.md,
    width: "100%",
  },
  socialBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  googleBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  facebookBtn: {
    backgroundColor: colors.primary,
  },
  googleIcon: {
    fontSize: 22,
    fontWeight: "700",
    color: "#486146",
  },
  googleText: {
    ...typography.cardTitle,
  },
  facebookIcon: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.surface,
    lineHeight: 24,
  },
  facebookText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: "700",
  },
  bottomTextRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.lg,
  },
  bottomText: {
    ...typography.body,
  },
  inlineLink: {
    ...typography.cardTitle,
    color: colors.primary,
  },
});