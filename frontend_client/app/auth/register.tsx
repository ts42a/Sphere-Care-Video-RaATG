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

const TOTAL_STEPS = 7;

const GENDER_OPTIONS = ["Male", "Female", "Other", "Prefer not to say"];

const GUARDIAN_TYPES: { value: string; label: string }[] = [
  { value: "legal_guardian", label: "Legal guardian" },
  { value: "power_of_attorney", label: "Power of attorney" },
  { value: "next_of_kin", label: "Next of kin" },
  { value: "responsible_person", label: "Responsible person" },
  { value: "medical_guardian", label: "Medical guardian" },
];

const CREATED_BY_OPTIONS: { value: string; label: string }[] = [
  { value: "self", label: "I am registering myself" },
  { value: "family", label: "Family member" },
  { value: "legal_representative", label: "Legal representative" },
  { value: "facility_staff", label: "Care facility staff" },
  { value: "other", label: "Other" },
];

const STEP_TITLES = [
  "Identity & account",
  "Your address",
  "Guardian",
  "Emergency contacts",
  "Who is creating this account",
  "Care centre",
  "Agreements",
];

type EmergencyRow = {
  fullName: string;
  relationship: string;
  phone: string;
  alternatePhone: string;
  email: string;
};

function CheckRow({
  checked,
  onToggle,
  label,
  linkLabel,
  onLink,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  linkLabel?: string;
  onLink?: () => void;
}) {
  return (
    <Pressable style={styles.checkRow} onPress={onToggle}>
      <View style={[styles.checkBox, checked && styles.checkBoxOn]}>
        {checked ? <Text style={styles.checkMark}>✓</Text> : null}
      </View>
      <View style={styles.checkLabelWrap}>
        <Text style={styles.checkLabel}>{label}</Text>
        {linkLabel && onLink ? (
          <Pressable onPress={onLink}>
            <Text style={styles.checkLink}>{linkLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function RegisterScreen() {
  const [step, setStep] = useState(1);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [email, setEmail] = useState("");
  const [emailConfirm, setEmailConfirm] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");

  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateRegion, setStateRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");

  const [guardianName, setGuardianName] = useState("");
  const [guardianRelationship, setGuardianRelationship] = useState("");
  const [guardianType, setGuardianType] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [guardianAddressSame, setGuardianAddressSame] = useState(true);
  const [gAddr1, setGAddr1] = useState("");
  const [gAddr2, setGAddr2] = useState("");
  const [gCity, setGCity] = useState("");
  const [gState, setGState] = useState("");
  const [gPostal, setGPostal] = useState("");
  const [gCountry, setGCountry] = useState("");

  const [emergencyRows, setEmergencyRows] = useState<EmergencyRow[]>([
    { fullName: "", relationship: "", phone: "", alternatePhone: "", email: "" },
  ]);

  const [registrationCompletedBy, setRegistrationCompletedBy] = useState("");
  const [assistedByName, setAssistedByName] = useState("");

  const [centerId, setCenterId] = useState("");

  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function updateEmergencyRow(index: number, patch: Partial<EmergencyRow>) {
    setEmergencyRows((rows) =>
      rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }

  function addEmergencyRow() {
    if (emergencyRows.length >= 3) return;
    setEmergencyRows((rows) => [
      ...rows,
      { fullName: "", relationship: "", phone: "", alternatePhone: "", email: "" },
    ]);
  }

  function removeEmergencyRow(index: number) {
    if (emergencyRows.length <= 1) return;
    setEmergencyRows((rows) => rows.filter((_, i) => i !== index));
  }

  function validateStep(s: number): string | null {
    if (s === 1) {
      if (
        !firstName.trim() ||
        !lastName.trim() ||
        !email.trim() ||
        !emailConfirm.trim() ||
        !phone.trim() ||
        !password ||
        !confirmPassword ||
        !dateOfBirth.trim() ||
        !gender.trim()
      ) {
        return "Please complete all required fields on this step";
      }
      if (email.trim().toLowerCase() !== emailConfirm.trim().toLowerCase()) {
        return "Email addresses do not match";
      }
      if (password !== confirmPassword) {
        return "Passwords do not match";
      }
    }
    if (s === 2) {
      if (!addressLine1.trim() || !city.trim() || !country.trim()) {
        return "Address line 1, city, and country are required";
      }
    }
    if (s === 3) {
      if (!guardianName.trim() || !guardianType.trim() || !guardianPhone.trim()) {
        return "Guardian name, type, and phone are required";
      }
      if (!guardianAddressSame) {
        if (!gAddr1.trim() || !gCity.trim() || !gCountry.trim()) {
          return "Guardian address needs line 1, city, and country (or use same as yours)";
        }
      }
    }
    if (s === 4) {
      const filled = emergencyRows.filter(
        (r) =>
          r.fullName.trim() ||
          r.phone.trim() ||
          r.relationship.trim() ||
          r.alternatePhone.trim() ||
          r.email.trim(),
      );
      const toCheck = filled.length > 0 ? filled : emergencyRows.slice(0, 1);
      for (let i = 0; i < toCheck.length; i++) {
        const r = toCheck[i];
        if (!r.fullName.trim() || !r.phone.trim()) {
          return `Emergency contact ${i + 1}: name and phone are required`;
        }
      }
    }
    if (s === 5) {
      if (!registrationCompletedBy) {
        return "Please select who is creating this account";
      }
    }
    if (s === 7) {
      if (!acceptTerms || !acceptPrivacy) {
        return "Please accept the Terms of Use and Privacy Policy";
      }
    }
    return null;
  }

  function goNext() {
    setError("");
    const msg = validateStep(step);
    if (msg) {
      setError(msg);
      return;
    }
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
    }
  }

  function goBack() {
    setError("");
    if (step > 1) {
      setStep(step - 1);
    }
  }

  function buildEmergencyList(): EmergencyRow[] {
    return emergencyRows.filter(
      (r) => r.fullName.trim() && r.phone.trim(),
    );
  }

  async function handleRegister() {
    setError("");
    const msg = validateStep(7);
    if (msg) {
      setError(msg);
      return;
    }

    const list = buildEmergencyList();
    if (list.length < 1) {
      setError("At least one emergency contact with name and phone is required");
      return;
    }

    try {
      setLoading(true);
      await authService.register({
        firstName,
        lastName,
        email,
        emailConfirm,
        phone,
        password,
        confirmPassword,
        dateOfBirth,
        gender,
        preferredName,
        centerId,
        addressLine1,
        addressLine2,
        city,
        state: stateRegion,
        postalCode,
        country,
        guardian: {
          fullName: guardianName,
          relationship: guardianRelationship,
          guardianType,
          phone: guardianPhone,
          email: guardianEmail,
          addressSameAsUser: guardianAddressSame,
          addressLine1: gAddr1,
          addressLine2: gAddr2,
          city: gCity,
          state: gState,
          postalCode: gPostal,
          country: gCountry,
        },
        emergencyContacts: list.map((r) => ({
          fullName: r.fullName,
          relationship: r.relationship,
          phone: r.phone,
          alternatePhone: r.alternatePhone,
          email: r.email,
        })),
        registrationCompletedBy,
        registrationAssistedByName: assistedByName,
        acceptTerms,
        acceptPrivacy,
        smsConsent,
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

  function renderProgress() {
    return (
      <View style={styles.progressWrap}>
        <View style={styles.segmentsRow}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <View
              key={i}
              style={[
                styles.segment,
                i < step && styles.segmentActive,
                i === step - 1 && styles.segmentCurrent,
              ]}
            />
          ))}
        </View>
      </View>
    );
  }

  function renderStepBody() {
    switch (step) {
      case 1:
        return (
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
              placeholder="Preferred name (optional)"
              placeholderTextColor={colors.textMuted}
              value={preferredName}
              onChangeText={setPreferredName}
            />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm email"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={emailConfirm}
              onChangeText={setEmailConfirm}
            />
            <View style={styles.phoneRow}>
              <Text style={styles.countryCode}>🇦🇺 ▾</Text>
              <TextInput
                style={styles.phoneInput}
                placeholder="Phone number"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />
            </View>
            <Text style={styles.fieldLabel}>Date of birth</Text>
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
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
          </>
        );
      case 2:
        return (
          <>
            <TextInput
              style={styles.input}
              placeholder="Address line 1"
              placeholderTextColor={colors.textMuted}
              value={addressLine1}
              onChangeText={setAddressLine1}
            />
            <TextInput
              style={styles.input}
              placeholder="Address line 2 (optional)"
              placeholderTextColor={colors.textMuted}
              value={addressLine2}
              onChangeText={setAddressLine2}
            />
            <View style={styles.nameRow}>
              <TextInput
                style={[styles.input, styles.nameInput, styles.nameInputTight]}
                placeholder="City"
                placeholderTextColor={colors.textMuted}
                value={city}
                onChangeText={setCity}
              />
              <TextInput
                style={[styles.input, styles.nameInput, styles.nameInputTight]}
                placeholder="State / region"
                placeholderTextColor={colors.textMuted}
                value={stateRegion}
                onChangeText={setStateRegion}
              />
            </View>
            <View style={styles.nameRow}>
              <TextInput
                style={[styles.input, styles.nameInput, styles.nameInputTight]}
                placeholder="Postcode"
                placeholderTextColor={colors.textMuted}
                value={postalCode}
                onChangeText={setPostalCode}
              />
              <TextInput
                style={[styles.input, styles.nameInput, styles.nameInputTight]}
                placeholder="Country"
                placeholderTextColor={colors.textMuted}
                value={country}
                onChangeText={setCountry}
              />
            </View>
          </>
        );
      case 3:
        return (
          <>
            <TextInput
              style={styles.input}
              placeholder="Guardian full name"
              placeholderTextColor={colors.textMuted}
              value={guardianName}
              onChangeText={setGuardianName}
            />
            <TextInput
              style={styles.input}
              placeholder="Relationship to you (optional)"
              placeholderTextColor={colors.textMuted}
              value={guardianRelationship}
              onChangeText={setGuardianRelationship}
            />
            <Text style={styles.fieldLabel}>Guardian type</Text>
            <View style={styles.genderRow}>
              {GUARDIAN_TYPES.map((gt) => (
                <Pressable
                  key={gt.value}
                  style={[
                    styles.genderBtn,
                    guardianType === gt.value && styles.genderBtnActive,
                  ]}
                  onPress={() => setGuardianType(gt.value)}
                >
                  <Text
                    style={[
                      styles.genderBtnText,
                      guardianType === gt.value && styles.genderBtnTextActive,
                    ]}
                  >
                    {gt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.input}
              placeholder="Guardian phone"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              value={guardianPhone}
              onChangeText={setGuardianPhone}
            />
            <TextInput
              style={styles.input}
              placeholder="Guardian email (optional)"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={guardianEmail}
              onChangeText={setGuardianEmail}
            />
            <CheckRow
              checked={guardianAddressSame}
              onToggle={() => setGuardianAddressSame(!guardianAddressSame)}
              label="Guardian address is the same as mine"
            />
            {!guardianAddressSame ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Guardian address line 1"
                  placeholderTextColor={colors.textMuted}
                  value={gAddr1}
                  onChangeText={setGAddr1}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Guardian address line 2 (optional)"
                  placeholderTextColor={colors.textMuted}
                  value={gAddr2}
                  onChangeText={setGAddr2}
                />
                <View style={styles.nameRow}>
                  <TextInput
                    style={[styles.input, styles.nameInput, styles.nameInputTight]}
                    placeholder="City"
                    placeholderTextColor={colors.textMuted}
                    value={gCity}
                    onChangeText={setGCity}
                  />
                  <TextInput
                    style={[styles.input, styles.nameInput, styles.nameInputTight]}
                    placeholder="State"
                    placeholderTextColor={colors.textMuted}
                    value={gState}
                    onChangeText={setGState}
                  />
                </View>
                <View style={styles.nameRow}>
                  <TextInput
                    style={[styles.input, styles.nameInput, styles.nameInputTight]}
                    placeholder="Postcode"
                    placeholderTextColor={colors.textMuted}
                    value={gPostal}
                    onChangeText={setGPostal}
                  />
                  <TextInput
                    style={[styles.input, styles.nameInput, styles.nameInputTight]}
                    placeholder="Country"
                    placeholderTextColor={colors.textMuted}
                    value={gCountry}
                    onChangeText={setGCountry}
                  />
                </View>
              </>
            ) : null}
          </>
        );
      case 4:
        return (
          <>
            {emergencyRows.map((row, index) => (
              <View key={index} style={styles.emergencyBlock}>
                <View style={styles.emergencyLabelRow}>
                  <Text style={styles.emergencyTitle}>
                    Emergency contact {index + 1}
                  </Text>
                  {emergencyRows.length > 1 ? (
                    <Pressable onPress={() => removeEmergencyRow(index)}>
                      <Text style={styles.inlineLink}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Full name"
                  placeholderTextColor={colors.textMuted}
                  value={row.fullName}
                  onChangeText={(t) => updateEmergencyRow(index, { fullName: t })}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Relationship (optional)"
                  placeholderTextColor={colors.textMuted}
                  value={row.relationship}
                  onChangeText={(t) => updateEmergencyRow(index, { relationship: t })}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Primary phone"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  value={row.phone}
                  onChangeText={(t) => updateEmergencyRow(index, { phone: t })}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Alternate phone (optional)"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  value={row.alternatePhone}
                  onChangeText={(t) => updateEmergencyRow(index, { alternatePhone: t })}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Email (optional)"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={row.email}
                  onChangeText={(t) => updateEmergencyRow(index, { email: t })}
                />
              </View>
            ))}
            {emergencyRows.length < 3 ? (
              <Pressable style={styles.secondaryOutlineBtn} onPress={addEmergencyRow}>
                <Text style={styles.secondaryOutlineBtnText}>+ Add another contact</Text>
              </Pressable>
            ) : null}
          </>
        );
      case 5:
        return (
          <>
            <Text style={styles.fieldLabel}>Who is completing this registration?</Text>
            <View style={styles.genderRow}>
              {CREATED_BY_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  style={[
                    styles.genderBtn,
                    registrationCompletedBy === opt.value && styles.genderBtnActive,
                  ]}
                  onPress={() => setRegistrationCompletedBy(opt.value)}
                >
                  <Text
                    style={[
                      styles.genderBtnText,
                      registrationCompletedBy === opt.value && styles.genderBtnTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Name of person assisting (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="If someone helped you register, their name"
              placeholderTextColor={colors.textMuted}
              value={assistedByName}
              onChangeText={setAssistedByName}
            />
          </>
        );
      case 6:
        return (
          <>
            <Text style={styles.hintText}>
              If your care centre gave you a centre ID, enter it here. You can skip this and add it later.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Centre ID (optional)"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              value={centerId}
              onChangeText={setCenterId}
            />
          </>
        );
      case 7:
        return (
          <>
            <CheckRow
              checked={acceptTerms}
              onToggle={() => setAcceptTerms(!acceptTerms)}
              label="I accept the Terms of Use"
              linkLabel="View terms"
              onLink={() => router.push("/legal/terms")}
            />
            <CheckRow
              checked={acceptPrivacy}
              onToggle={() => setAcceptPrivacy(!acceptPrivacy)}
              label="I accept the Privacy Policy"
              linkLabel="View policy"
              onLink={() => router.push("/legal/privacy")}
            />
            <CheckRow
              checked={smsConsent}
              onToggle={() => setSmsConsent(!smsConsent)}
              label="I agree to receive SMS notifications where applicable (optional)"
            />
          </>
        );
      default:
        return null;
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

            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>
                Step {step} of {TOTAL_STEPS}
              </Text>
            </View>
            <Text style={styles.title}>Create account</Text>
            <Text style={styles.subtitle}>{STEP_TITLES[step - 1]}</Text>
            {step === 1 ? (
              <Text style={styles.stepHint}>
                Multi-step signup: after your details you&apos;ll add your address, guardian, emergency
                contacts, and accept policies. Use Next to continue.
              </Text>
            ) : null}

            {renderProgress()}

            <View style={styles.form}>
              {renderStepBody()}

              {!!error && <Text style={styles.errorText}>{error}</Text>}

              <View style={styles.btnRow}>
                {step > 1 ? (
                  <Pressable
                    style={[styles.primaryBtn, styles.backBtn]}
                    onPress={goBack}
                  >
                    <Text style={[styles.primaryBtnText, styles.backBtnText]}>Back</Text>
                  </Pressable>
                ) : (
                  <View style={{ flex: 0.5 }} />
                )}

                {step < TOTAL_STEPS ? (
                  <Pressable style={[styles.primaryBtn, { flex: 1 }]} onPress={goNext}>
                    <Text style={styles.primaryBtnText}>Next</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={[styles.primaryBtn, { flex: 1 }]}
                    onPress={handleRegister}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color={colors.surface} />
                    ) : (
                      <Text style={styles.primaryBtnText}>Create account</Text>
                    )}
                  </Pressable>
                )}
              </View>
            </View>

            {step === 1 ? (
              <>
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
              </>
            ) : null}

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
  stepBadge: {
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    marginBottom: spacing.md,
  },
  stepBadgeText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primary,
    letterSpacing: 0.3,
  },
  title: {
    ...typography.pageTitle,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  subtitle: {
    ...typography.body,
    textAlign: "center",
    marginBottom: spacing.sm,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  stepHint: {
    ...typography.subText,
    textAlign: "center",
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.sm,
    color: colors.textMuted,
    lineHeight: 20,
  },
  progressWrap: {
    width: "100%",
    marginBottom: spacing.xl,
  },
  segmentsRow: {
    flexDirection: "row",
    gap: 5,
    width: "100%",
  },
  segment: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
  },
  segmentActive: {
    backgroundColor: colors.primary,
  },
  segmentCurrent: {
    opacity: 1,
    transform: [{ scaleY: 1.15 }],
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    alignSelf: "flex-start",
    width: "100%",
  },
  hintText: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    textAlign: "left",
    width: "100%",
  },
  genderRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: spacing.lg,
  },
  genderBtn: {
    paddingHorizontal: 14,
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
    fontSize: 13,
    color: colors.textSecondary,
  },
  genderBtnTextActive: {
    color: colors.surface,
    fontWeight: "600",
  },
  btnRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: spacing.md,
    width: "100%",
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
    width: "100%",
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
    width: "100%",
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
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    marginBottom: spacing.lg,
    width: "100%",
  },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkBoxOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkMark: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "700",
  },
  checkLabelWrap: {
    flex: 1,
  },
  checkLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  checkLink: {
    ...typography.cardTitle,
    color: colors.primary,
    marginTop: spacing.xs,
    fontSize: 14,
  },
  emergencyBlock: {
    width: "100%",
    marginBottom: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
  },
  emergencyLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    marginBottom: spacing.sm,
  },
  emergencyTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textSecondary,
    flex: 1,
  },
  secondaryOutlineBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 14,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  secondaryOutlineBtnText: {
    color: colors.primary,
    fontWeight: "600",
  },
});
