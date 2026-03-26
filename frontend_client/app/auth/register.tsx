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

const GENDER_OPTIONS = ["Male", "Female", "Other", "Prefer not to say"];

export default function RegisterScreen() {
  const [step, setStep] = useState(1);

  // Step 1 fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Step 2 fields
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [centerId, setCenterId] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleNext() {
    setError("");
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim() || !password || !confirmPassword) {
      setError("Please complete all required fields");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setStep(2);
  }

  async function handleRegister() {
    setError("");

    if (!dateOfBirth.trim() || !gender.trim()) {
      setError("Please provide your date of birth and gender");
      return;
    }

    try {
      setLoading(true);
      await authService.register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password,
        confirmPassword,
        dateOfBirth: dateOfBirth.trim(),
        gender: gender.trim(),
        centerId: centerId.trim() || undefined,
      });

      Alert.alert("Registration successful", "Your account is ready.", [
        {
          text: "Continue",
          onPress: () => {
            if (Platform.OS === "web" && typeof window !== "undefined") {
              window.location.href = "http://localhost:3000/";
              return;
            }
            router.replace("/");
          },
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
            <Text style={styles.subtitle}>
              {step === 1 ? "Enter your basic details" : "Tell us a bit more about yourself"}
            </Text>

            {/* Step indicator */}
            <View style={styles.stepRow}>
              <View style={[styles.stepDot, step >= 1 && styles.stepDotActive]} />
              <View style={[styles.stepBar, step >= 2 && styles.stepBarActive]} />
              <View style={[styles.stepDot, step >= 2 && styles.stepDotActive]} />
            </View>

            <View style={styles.form}>
              {step === 1 ? (
                <>
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

                  <Pressable style={styles.primaryBtn} onPress={handleNext}>
                    <Text style={styles.primaryBtnText}>Next</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>Date of Birth</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.textMuted}
                    value={dateOfBirth}
                    onChangeText={setDateOfBirth}
                  />

                  <Text style={styles.fieldLabel}>Gender</Text>
                  <View style={styles.genderRow}>
                    {GENDER_OPTIONS.map((g) => (
                      <Pressable
                        key={g}
                        style={[styles.genderBtn, gender === g && styles.genderBtnActive]}
                        onPress={() => setGender(g)}
                      >
                        <Text
                          style={[styles.genderBtnText, gender === g && styles.genderBtnTextActive]}
                        >
                          {g}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.fieldLabel}>Center ID (optional)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. CTR-3 (ask your care centre)"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="characters"
                    value={centerId}
                    onChangeText={setCenterId}
                  />

                  {!!error && <Text style={styles.errorText}>{error}</Text>}

                  <View style={styles.btnRow}>
                    <Pressable
                      style={[styles.primaryBtn, styles.backBtn]}
                      onPress={() => { setError(""); setStep(1); }}
                    >
                      <Text style={[styles.primaryBtnText, styles.backBtnText]}>Back</Text>
                    </Pressable>

                    <Pressable
                      style={[styles.primaryBtn, { flex: 1 }]}
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
                </>
              )}
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

            <View style={styles.bottomTextRow}>
              <Text style={styles.bottomText}>Already have an account? </Text>
              <Pressable onPress={() => router.push("/auth/login")}>
                <Text style={styles.inlineLink}>Login</Text>
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
    marginBottom: spacing.md,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xxl,
  },
  stepDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.borderStrong,
  },
  stepDotActive: {
    backgroundColor: colors.primary,
  },
  stepBar: {
    width: 60,
    height: 3,
    backgroundColor: colors.borderStrong,
    marginHorizontal: 4,
  },
  stepBarActive: {
    backgroundColor: colors.primary,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  genderRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: spacing.lg,
  },
  genderBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  genderBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  genderBtnText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  genderBtnTextActive: {
    color: colors.surface,
    fontWeight: "600",
  },
  btnRow: {
    flexDirection: "row",
    gap: 12,
  },
  backBtn: {
    flex: 0.5,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  backBtnText: {
    color: colors.textSecondary,
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