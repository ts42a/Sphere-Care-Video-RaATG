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
  Alert,
  Image,
} from "react-native";
import { router } from "expo-router";
import { Images } from "../../src/constants/images";
import { authService } from "../../src/services/authService";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";

export default function RegisterScreen() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    setError("");

    try {
      setLoading(true);
      await authService.register({
        firstName,
        lastName,
        email,
        phone,
        password,
        confirmPassword,
      });

      Alert.alert("Registration successful", "Please log in to continue.", [
        {
          text: "OK",
          onPress: () => router.replace("/auth/login"),
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Register failed");
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

            <Text style={styles.title}>Register</Text>
            <Text style={styles.subtitle}>Enter your details to register</Text>

            <View style={styles.form}>
              <View style={styles.nameRow}>
                <TextInput
                  style={[styles.input, styles.nameInput, styles.nameInputTight]}
                  placeholder="First name"
                  placeholderTextColor={colors.textMuted}
                  value={firstName}
                  onChangeText={setFirstName}
                />

                <TextInput
                  style={[styles.input, styles.nameInput, styles.nameInputTight]}
                  placeholder="Last name"
                  placeholderTextColor={colors.textMuted}
                  value={lastName}
                  onChangeText={setLastName}
                />
              </View>

              <TextInput
                style={styles.input}
                placeholder="Enter your Email here"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />

              <View style={styles.phoneRow}>
                <Text style={styles.countryCode}>🇦🇺 ▾</Text>
                <TextInput
                  style={styles.phoneInput}
                  placeholder="Enter your phone number here"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={setPhone}
                />
              </View>

              <TextInput
                style={styles.input}
                placeholder="Enter your password here"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />

              <TextInput
                style={styles.input}
                placeholder="Confirm your password here"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />

              {!!error && <Text style={styles.errorText}>{error}</Text>}

              <Pressable
                style={styles.primaryBtn}
                onPress={handleRegister}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={colors.surface} />
                ) : (
                  <Text style={styles.primaryBtnText}>Register</Text>
                )}
              </Pressable>
            </View>

            <View style={styles.loginPromptWrap}>
              <Text style={styles.loginPromptText}>
                already have account continue with log in
              </Text>
            </View>

            <Text style={styles.dividerText}>Or register with</Text>

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
    marginBottom: spacing.xxl,
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
    marginBottom: spacing.xxl,
  },
  nameRow: {
  flexDirection: "row",
  gap: 12,
  marginBottom: 16,
  },
  nameInput: {
    flex: 1,
  },
  nameInputTight: {
  marginBottom: 0,
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
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    height: 56,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    marginBottom: spacing.lg,
  },
  countryCode: {
    ...typography.body,
  },
  phoneInput: {
    flex: 1,
    ...typography.body,
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
  loginPromptWrap: {
    width: "100%",
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  loginPromptText: {
    ...typography.body,
    textAlign: "left",
    lineHeight: 24,
  },
  dividerText: {
    ...typography.subText,
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
});