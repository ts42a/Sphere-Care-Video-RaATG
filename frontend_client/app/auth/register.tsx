import { useMemo, useState } from "react";
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
  Modal,
  FlatList,
} from "react-native";
import { router } from "expo-router";
import { CountryPicker } from "react-native-country-codes-picker";
import { Images } from "../../src/constants/images";
import { authService } from "../../src/services/authService";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";

const TOTAL_STEPS = 7;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_DOB_YEAR = CURRENT_YEAR - 65;
const MIN_DOB_YEAR = CURRENT_YEAR - 120;
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - MIN_DOB_YEAR + 1 }, (_, i) => String(CURRENT_YEAR - i));
const DEFAULT_DOB_YEAR_INDEX = YEAR_OPTIONS.indexOf(String(DEFAULT_DOB_YEAR));
const DROPDOWN_OPTION_ESTIMATED_HEIGHT = 47;
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

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
  phoneCountryCode: string;
  phone: string;
  alternatePhoneCountryCode: string;
  alternatePhone: string;
  email: string;
};

type DropdownOption = {
  label: string;
  value: string;
};

type CountryPickerTarget = {
  key: string;
  onSelect: (dialCode: string) => void;
};

function cleanPhone(value: string) {
  return value.replace(/[^0-9]/g, "");
}

function formatPhone(countryCode: string, localPhone: string) {
  const digits = cleanPhone(localPhone);
  if (!digits) return "";
  return `${countryCode}${digits}`;
}

function daysInMonth(year: string, month: string) {
  if (!year || !month) return 31;
  return new Date(Number(year), Number(month), 0).getDate();
}

function makeEmergencyRow(): EmergencyRow {
  return {
    fullName: "",
    relationship: "",
    phoneCountryCode: "+61",
    phone: "",
    alternatePhoneCountryCode: "+61",
    alternatePhone: "",
    email: "",
  };
}

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
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              onLink();
            }}
          >
            <Text style={styles.checkLink}>{linkLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

function InlineDropdown({
  label,
  value,
  placeholder,
  options,
  openKey,
  expandedKey,
  setExpandedKey,
  onSelect,
  compact,
  initialScrollIndex,
}: {
  label?: string;
  value: string;
  placeholder: string;
  options: DropdownOption[];
  openKey: string;
  expandedKey: string | null;
  setExpandedKey: (key: string | null) => void;
  onSelect: (value: string) => void;
  compact?: boolean;
  initialScrollIndex?: number;
}) {
  const isOpen = expandedKey === openKey;
  const selected = options.find((item) => item.value === value);
  const selectedIndex = options.findIndex((item) => item.value === value);
  const modalInitialIndex = selectedIndex >= 0 ? selectedIndex : initialScrollIndex ?? 0;

  return (
    <View style={[styles.dropdownWrap, compact && styles.dropdownWrapCompact]}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <Pressable
        style={[styles.dropdownButton, compact && styles.dropdownButtonCompact]}
        onPress={() => setExpandedKey(isOpen ? null : openKey)}
      >
        <Text style={[styles.dropdownText, !selected && styles.placeholderText]} numberOfLines={1}>
          {selected?.label || placeholder}
        </Text>
        <Text style={styles.dropdownArrow}>▾</Text>
      </Pressable>

      <Modal transparent visible={isOpen} animationType="fade" onRequestClose={() => setExpandedKey(null)}>
        <Pressable style={styles.dropdownModalBackdrop} onPress={() => setExpandedKey(null)}>
          <Pressable style={styles.dropdownModalCard} onPress={(event) => event.stopPropagation()}>
            <View style={styles.dropdownModalHeader}>
              <Text style={styles.dropdownModalTitle}>{placeholder}</Text>
              <Pressable onPress={() => setExpandedKey(null)} hitSlop={10}>
                <Text style={styles.dropdownModalClose}>×</Text>
              </Pressable>
            </View>
            <FlatList
              data={options}
              keyExtractor={(item) => item.value}
              style={styles.dropdownModalList}
              initialScrollIndex={modalInitialIndex > 0 ? modalInitialIndex : undefined}
              getItemLayout={(_, index) => ({
                length: DROPDOWN_OPTION_ESTIMATED_HEIGHT,
                offset: DROPDOWN_OPTION_ESTIMATED_HEIGHT * index,
                index,
              })}
              onScrollToIndexFailed={() => undefined}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.dropdownOption, value === item.value && styles.dropdownOptionActive]}
                  onPress={() => {
                    onSelect(item.value);
                    setExpandedKey(null);
                  }}
                >
                  <Text
                    style={[
                      styles.dropdownOptionText,
                      value === item.value && styles.dropdownOptionTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export default function RegisterScreen() {
  const [step, setStep] = useState(1);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [countryPickerTarget, setCountryPickerTarget] = useState<CountryPickerTarget | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [email, setEmail] = useState("");
  const [emailConfirm, setEmailConfirm] = useState("");
  const [phoneCountryCode, setPhoneCountryCode] = useState("+61");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [dobYear, setDobYear] = useState("");
  const [dobMonth, setDobMonth] = useState("");
  const [dobDay, setDobDay] = useState("");
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
  const [guardianPhoneCountryCode, setGuardianPhoneCountryCode] = useState("+61");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [guardianAddressSame, setGuardianAddressSame] = useState(true);
  const [gAddr1, setGAddr1] = useState("");
  const [gAddr2, setGAddr2] = useState("");
  const [gCity, setGCity] = useState("");
  const [gState, setGState] = useState("");
  const [gPostal, setGPostal] = useState("");
  const [gCountry, setGCountry] = useState("");

  const [emergencyRows, setEmergencyRows] = useState<EmergencyRow[]>([makeEmergencyRow()]);

  const [registrationCompletedBy, setRegistrationCompletedBy] = useState("");
  const [assistedByName, setAssistedByName] = useState("");

  const [centerId, setCenterId] = useState("");

  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const dayOptions = useMemo(() => {
    const count = daysInMonth(dobYear, dobMonth);
    return Array.from({ length: count }, (_, i) => {
      const value = String(i + 1).padStart(2, "0");
      return { label: value, value };
    });
  }, [dobYear, dobMonth]);

  const dateOfBirth = dobYear && dobMonth && dobDay ? `${dobYear}-${dobMonth}-${dobDay}` : "";

  function updateEmergencyRow(index: number, patch: Partial<EmergencyRow>) {
    setEmergencyRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addEmergencyRow() {
    if (emergencyRows.length >= 3) return;
    setEmergencyRows((rows) => [...rows, makeEmergencyRow()]);
  }

  function removeEmergencyRow(index: number) {
    if (emergencyRows.length <= 1) return;
    setEmergencyRows((rows) => rows.filter((_, i) => i !== index));
  }

  function validateEmail(value: string, message: string) {
    if (!EMAIL_PATTERN.test(value.trim())) return message;
    return null;
  }

  function validatePhone(value: string, message: string) {
    const digits = cleanPhone(value);
    if (digits.length < 6 || digits.length > 15) return message;
    return null;
  }

  function validatePassword(value: string) {
    if (value.length < 8) return "Password must be at least 8 characters";
    if (!/[A-Z]/.test(value)) return "Password must contain at least 1 uppercase letter";
    if (!/[a-z]/.test(value)) return "Password must contain at least 1 lowercase letter";
    if (!/\d/.test(value)) return "Password must contain at least 1 number";
    return null;
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
        !dateOfBirth ||
        !gender.trim()
      ) {
        return "Please complete all required fields on this step";
      }
      const emailError = validateEmail(email, "Please enter a valid email address");
      if (emailError) return emailError;
      const emailConfirmError = validateEmail(emailConfirm, "Please enter a valid confirmation email");
      if (emailConfirmError) return emailConfirmError;
      if (email.trim().toLowerCase() !== emailConfirm.trim().toLowerCase()) {
        return "Email addresses do not match";
      }
      const phoneError = validatePhone(phone, "Please enter a valid phone number");
      if (phoneError) return phoneError;
      const passwordError = validatePassword(password);
      if (passwordError) return passwordError;
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
      const guardianPhoneError = validatePhone(guardianPhone, "Please enter a valid guardian phone number");
      if (guardianPhoneError) return guardianPhoneError;
      if (guardianEmail.trim() && !EMAIL_PATTERN.test(guardianEmail.trim())) {
        return "Please enter a valid guardian email address";
      }
      if (!guardianAddressSame && (!gAddr1.trim() || !gCity.trim() || !gCountry.trim())) {
        return "Guardian address needs line 1, city, and country, or use same as yours";
      }
    }
    if (s === 4) {
      const filled = emergencyRows.filter(
        (r) => r.fullName.trim() || r.phone.trim() || r.relationship.trim() || r.alternatePhone.trim() || r.email.trim(),
      );
      const toCheck = filled.length > 0 ? filled : emergencyRows.slice(0, 1);
      for (let i = 0; i < toCheck.length; i++) {
        const r = toCheck[i];
        if (!r.fullName.trim() || !r.phone.trim()) {
          return `Emergency contact ${i + 1}: name and phone are required`;
        }
        const emergencyPhoneError = validatePhone(r.phone, `Emergency contact ${i + 1}: please enter a valid phone number`);
        if (emergencyPhoneError) return emergencyPhoneError;
        if (r.alternatePhone.trim()) {
          const alternatePhoneError = validatePhone(
            r.alternatePhone,
            `Emergency contact ${i + 1}: please enter a valid alternate phone number`,
          );
          if (alternatePhoneError) return alternatePhoneError;
        }
        if (r.email.trim() && !EMAIL_PATTERN.test(r.email.trim())) {
          return `Emergency contact ${i + 1}: please enter a valid email address`;
        }
      }
    }
    if (s === 5 && !registrationCompletedBy) {
      return "Please select who is creating this account";
    }
    if (s === 7 && (!acceptTerms || !acceptPrivacy)) {
      return "Please accept the Terms of Use and Privacy Policy";
    }
    return null;
  }

  function goNext() {
    setError("");
    setExpandedKey(null);
    setCountryPickerTarget(null);
    const msg = validateStep(step);
    if (msg) {
      setError(msg);
      return;
    }
    if (step < TOTAL_STEPS) setStep(step + 1);
  }

  function goBack() {
    setError("");
    setExpandedKey(null);
    setCountryPickerTarget(null);
    if (step > 1) setStep(step - 1);
  }

  function buildEmergencyList(): EmergencyRow[] {
    return emergencyRows.filter((r) => r.fullName.trim() && r.phone.trim());
  }

  async function handleRegister() {
    setError("");
    setExpandedKey(null);
    setCountryPickerTarget(null);
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
        email: email.trim().toLowerCase(),
        emailConfirm: emailConfirm.trim().toLowerCase(),
        phone: formatPhone(phoneCountryCode, phone),
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
          phone: formatPhone(guardianPhoneCountryCode, guardianPhone),
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
          phone: formatPhone(r.phoneCountryCode, r.phone),
          alternatePhone: r.alternatePhone.trim()
            ? formatPhone(r.alternatePhoneCountryCode, r.alternatePhone)
            : "",
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
              style={[styles.segment, i < step && styles.segmentActive, i === step - 1 && styles.segmentCurrent]}
            />
          ))}
        </View>
      </View>
    );
  }

  function renderPhoneField({
    value,
    countryCode,
    onChangeText,
    onChangeCountryCode,
    placeholder,
    openKey,
  }: {
    value: string;
    countryCode: string;
    onChangeText: (value: string) => void;
    onChangeCountryCode: (value: string) => void;
    placeholder: string;
    openKey: string;
  }) {
    return (
      <View style={styles.phoneRow}>
        <Pressable
          style={styles.countryPickerButton}
          onPress={() => {
            setExpandedKey(null);
            setCountryPickerTarget({ key: openKey, onSelect: onChangeCountryCode });
          }}
        >
          <Text style={styles.countryPickerButtonText} numberOfLines={1}>
            {countryCode === "+61" ? "🇦🇺 +61" : `🌐 ${countryCode}`}
          </Text>
          <Text style={styles.dropdownArrow}>▾</Text>
        </Pressable>
        <TextInput
          style={styles.phoneInput}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          value={value}
          onChangeText={(text) => onChangeText(text.replace(/[^0-9\s-]/g, ""))}
        />
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
            <Text style={styles.fieldLabel}>Phone number</Text>
            {renderPhoneField({
              value: phone,
              countryCode: phoneCountryCode,
              onChangeText: setPhone,
              onChangeCountryCode: setPhoneCountryCode,
              placeholder: "Phone number",
              openKey: "phone-main",
            })}
            <Text style={styles.fieldLabel}>Date of birth</Text>
            <View style={styles.dateRow}>
              <InlineDropdown
                value={dobYear}
                placeholder="Year"
                options={YEAR_OPTIONS.map((year) => ({ label: year, value: year }))}
                openKey="dob-year"
                expandedKey={expandedKey}
                setExpandedKey={setExpandedKey}
                initialScrollIndex={DEFAULT_DOB_YEAR_INDEX}
                onSelect={(value) => {
                  setDobYear(value);
                  const maxDay = daysInMonth(value, dobMonth);
                  if (dobDay && Number(dobDay) > maxDay) setDobDay(String(maxDay).padStart(2, "0"));
                }}
              />
              <InlineDropdown
                value={dobMonth}
                placeholder="Month"
                options={MONTH_OPTIONS.map((month) => ({ label: month, value: month }))}
                openKey="dob-month"
                expandedKey={expandedKey}
                setExpandedKey={setExpandedKey}
                onSelect={(value) => {
                  setDobMonth(value);
                  const maxDay = daysInMonth(dobYear, value);
                  if (dobDay && Number(dobDay) > maxDay) setDobDay(String(maxDay).padStart(2, "0"));
                }}
              />
              <InlineDropdown
                value={dobDay}
                placeholder="Day"
                options={dayOptions}
                openKey="dob-day"
                expandedKey={expandedKey}
                setExpandedKey={setExpandedKey}
                onSelect={setDobDay}
              />
            </View>
            <Text style={styles.fieldLabel}>Gender</Text>
            <View style={styles.genderRow}>
              {GENDER_OPTIONS.map((g) => (
                <Pressable
                  key={g}
                  style={[styles.genderBtn, gender === g && styles.genderBtnActive]}
                  onPress={() => setGender(g)}
                >
                  <Text style={[styles.genderBtnText, gender === g && styles.genderBtnTextActive]}>{g}</Text>
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
            <Text style={styles.passwordHint}>Use 8+ characters with uppercase, lowercase, and a number.</Text>
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
            <TextInput style={styles.input} placeholder="Address line 1" placeholderTextColor={colors.textMuted} value={addressLine1} onChangeText={setAddressLine1} />
            <TextInput style={styles.input} placeholder="Address line 2 (optional)" placeholderTextColor={colors.textMuted} value={addressLine2} onChangeText={setAddressLine2} />
            <View style={styles.nameRow}>
              <TextInput style={[styles.input, styles.nameInput, styles.nameInputTight]} placeholder="City" placeholderTextColor={colors.textMuted} value={city} onChangeText={setCity} />
              <TextInput style={[styles.input, styles.nameInput, styles.nameInputTight]} placeholder="State / region" placeholderTextColor={colors.textMuted} value={stateRegion} onChangeText={setStateRegion} />
            </View>
            <View style={styles.nameRow}>
              <TextInput style={[styles.input, styles.nameInput, styles.nameInputTight]} placeholder="Postcode" placeholderTextColor={colors.textMuted} value={postalCode} onChangeText={setPostalCode} />
              <TextInput style={[styles.input, styles.nameInput, styles.nameInputTight]} placeholder="Country" placeholderTextColor={colors.textMuted} value={country} onChangeText={setCountry} />
            </View>
          </>
        );
      case 3:
        return (
          <>
            <TextInput style={styles.input} placeholder="Guardian full name" placeholderTextColor={colors.textMuted} value={guardianName} onChangeText={setGuardianName} />
            <TextInput style={styles.input} placeholder="Relationship to you (optional)" placeholderTextColor={colors.textMuted} value={guardianRelationship} onChangeText={setGuardianRelationship} />
            <Text style={styles.fieldLabel}>Guardian type</Text>
            <View style={styles.genderRow}>
              {GUARDIAN_TYPES.map((gt) => (
                <Pressable key={gt.value} style={[styles.genderBtn, guardianType === gt.value && styles.genderBtnActive]} onPress={() => setGuardianType(gt.value)}>
                  <Text style={[styles.genderBtnText, guardianType === gt.value && styles.genderBtnTextActive]}>{gt.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Guardian phone</Text>
            {renderPhoneField({
              value: guardianPhone,
              countryCode: guardianPhoneCountryCode,
              onChangeText: setGuardianPhone,
              onChangeCountryCode: setGuardianPhoneCountryCode,
              placeholder: "Guardian phone",
              openKey: "phone-guardian",
            })}
            <TextInput
              style={styles.input}
              placeholder="Guardian email (optional)"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={guardianEmail}
              onChangeText={setGuardianEmail}
            />
            <CheckRow checked={guardianAddressSame} onToggle={() => setGuardianAddressSame(!guardianAddressSame)} label="Guardian address is the same as mine" />
            {!guardianAddressSame ? (
              <>
                <TextInput style={styles.input} placeholder="Guardian address line 1" placeholderTextColor={colors.textMuted} value={gAddr1} onChangeText={setGAddr1} />
                <TextInput style={styles.input} placeholder="Guardian address line 2 (optional)" placeholderTextColor={colors.textMuted} value={gAddr2} onChangeText={setGAddr2} />
                <View style={styles.nameRow}>
                  <TextInput style={[styles.input, styles.nameInput, styles.nameInputTight]} placeholder="City" placeholderTextColor={colors.textMuted} value={gCity} onChangeText={setGCity} />
                  <TextInput style={[styles.input, styles.nameInput, styles.nameInputTight]} placeholder="State" placeholderTextColor={colors.textMuted} value={gState} onChangeText={setGState} />
                </View>
                <View style={styles.nameRow}>
                  <TextInput style={[styles.input, styles.nameInput, styles.nameInputTight]} placeholder="Postcode" placeholderTextColor={colors.textMuted} value={gPostal} onChangeText={setGPostal} />
                  <TextInput style={[styles.input, styles.nameInput, styles.nameInputTight]} placeholder="Country" placeholderTextColor={colors.textMuted} value={gCountry} onChangeText={setGCountry} />
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
                  <Text style={styles.emergencyTitle}>Emergency contact {index + 1}</Text>
                  {emergencyRows.length > 1 ? (
                    <Pressable onPress={() => removeEmergencyRow(index)}>
                      <Text style={styles.inlineLink}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
                <TextInput style={styles.input} placeholder="Full name" placeholderTextColor={colors.textMuted} value={row.fullName} onChangeText={(t) => updateEmergencyRow(index, { fullName: t })} />
                <TextInput style={styles.input} placeholder="Relationship (optional)" placeholderTextColor={colors.textMuted} value={row.relationship} onChangeText={(t) => updateEmergencyRow(index, { relationship: t })} />
                <Text style={styles.fieldLabel}>Primary phone</Text>
                {renderPhoneField({
                  value: row.phone,
                  countryCode: row.phoneCountryCode,
                  onChangeText: (t) => updateEmergencyRow(index, { phone: t }),
                  onChangeCountryCode: (t) => updateEmergencyRow(index, { phoneCountryCode: t }),
                  placeholder: "Primary phone",
                  openKey: `phone-emergency-${index}`,
                })}
                <Text style={styles.fieldLabel}>Alternate phone (optional)</Text>
                {renderPhoneField({
                  value: row.alternatePhone,
                  countryCode: row.alternatePhoneCountryCode,
                  onChangeText: (t) => updateEmergencyRow(index, { alternatePhone: t }),
                  onChangeCountryCode: (t) => updateEmergencyRow(index, { alternatePhoneCountryCode: t }),
                  placeholder: "Alternate phone",
                  openKey: `phone-emergency-alt-${index}`,
                })}
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
                <Pressable key={opt.value} style={[styles.genderBtn, registrationCompletedBy === opt.value && styles.genderBtnActive]} onPress={() => setRegistrationCompletedBy(opt.value)}>
                  <Text style={[styles.genderBtnText, registrationCompletedBy === opt.value && styles.genderBtnTextActive]}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Name of person assisting (optional)</Text>
            <TextInput style={styles.input} placeholder="If someone helped you register, their name" placeholderTextColor={colors.textMuted} value={assistedByName} onChangeText={setAssistedByName} />
          </>
        );
      case 6:
        return (
          <>
            <Text style={styles.hintText}>If your care centre gave you a centre ID, enter it here. You can skip this and add it later.</Text>
            <TextInput style={styles.input} placeholder="Centre ID (optional)" placeholderTextColor={colors.textMuted} autoCapitalize="characters" value={centerId} onChangeText={setCenterId} />
          </>
        );
      case 7:
        return (
          <>
            <Text style={styles.hintText}>Please review the demo legal documents below. These are placeholders and can be replaced with your team&apos;s final legal text later.</Text>
            <CheckRow checked={acceptTerms} onToggle={() => setAcceptTerms(!acceptTerms)} label="I accept the Terms of Use" linkLabel="View terms" onLink={() => router.push("/legal/terms")} />
            <CheckRow checked={acceptPrivacy} onToggle={() => setAcceptPrivacy(!acceptPrivacy)} label="I accept the Privacy Policy" linkLabel="View policy" onLink={() => router.push("/legal/privacy")} />
            <CheckRow checked={smsConsent} onToggle={() => setSmsConsent(!smsConsent)} label="I agree to receive SMS notifications where applicable (optional)" />
          </>
        );
      default:
        return null;
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.screen}>
            <View style={styles.logoWrap}>
              <Image source={Images.logo_2} style={{ width: 250, height: 60, resizeMode: "contain" }} />
            </View>

            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>Step {step} of {TOTAL_STEPS}</Text>
            </View>
            <Text style={styles.title}>Create account</Text>
            <Text style={styles.subtitle}>{STEP_TITLES[step - 1]}</Text>
            {step === 1 ? (
              <Text style={styles.stepHint}>Multi-step signup: after your details you&apos;ll add your address, guardian, emergency contacts, and accept policies. Use Next to continue.</Text>
            ) : null}

            {renderProgress()}

            <View style={styles.form}>
              {renderStepBody()}

              {!!error && <Text style={styles.errorText}>{error}</Text>}

              <View style={styles.btnRow}>
                {step > 1 ? (
                  <Pressable style={[styles.primaryBtn, styles.backBtn]} onPress={goBack}>
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
                  <Pressable style={[styles.primaryBtn, { flex: 1 }, loading && styles.disabledBtn]} onPress={handleRegister} disabled={loading}>
                    {loading ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.primaryBtnText}>Create account</Text>}
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
        <CountryPicker
          show={countryPickerTarget !== null}
          lang="en"
          inputPlaceholder="Search country or code"
          onBackdropPress={() => setCountryPickerTarget(null)}
          pickerButtonOnPress={(item: any) => {
            const dialCode = item?.dial_code || item?.dialCode || item?.callingCode;
            if (dialCode && countryPickerTarget) {
              countryPickerTarget.onSelect(dialCode);
            }
            setCountryPickerTarget(null);
          }}
          style={{
            modal: styles.countryPickerModal,
            countryButtonStyles: styles.countryPickerOption,
            textInput: styles.countryPickerSearch,
          }}
        />
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
    lineHeight: 22,
  },
  passwordHint: {
    ...typography.subText,
    color: colors.textMuted,
    marginTop: -spacing.md,
    marginBottom: spacing.lg,
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
  disabledBtn: {
    opacity: 0.7,
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
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.lg,
    width: "100%",
    zIndex: 20,
  },
  countryPickerButton: {
    minWidth: 110,
    height: 56,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  countryPickerButtonText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: "700",
  },
  countryPickerModal: {
    height: 540,
    backgroundColor: colors.background,
  },
  countryPickerSearch: {
    height: 50,
    borderRadius: 14,
    backgroundColor: colors.surface,
    color: colors.textSecondary,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  countryPickerOption: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginVertical: 4,
  },
  phoneInput: {
    flex: 1,
    height: 56,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    color: colors.textSecondary,
    fontSize: 16,
  },
  dateRow: {
    flexDirection: "row",
    gap: spacing.sm,
    width: "100%",
    marginBottom: spacing.lg,
    alignItems: "flex-start",
    zIndex: 15,
  },
  dropdownWrap: {
    flex: 1,
    position: "relative",
    zIndex: 25,
  },
  dropdownWrapCompact: {
    flex: 0,
    width: 112,
  },
  dropdownButton: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownButtonCompact: {
    width: 112,
  },
  dropdownText: {
    flex: 1,
    fontSize: 15,
    color: colors.textSecondary,
  },
  placeholderText: {
    color: colors.textMuted,
  },
  dropdownArrow: {
    marginLeft: spacing.xs,
    color: colors.textMuted,
    fontSize: 14,
  },
  dropdownPanel: {
    position: "absolute",
    top: 60,
    left: 0,
    right: 0,
    maxHeight: 220,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    backgroundColor: colors.surface,
    overflow: "hidden",
    zIndex: 100,
    elevation: 8,
  },
  dropdownScroll: {
    maxHeight: 220,
  },
  dropdownModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  dropdownModalCard: {
    maxHeight: "62%",
    borderRadius: 22,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  dropdownModalHeader: {
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownModalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  dropdownModalClose: {
    fontSize: 28,
    color: colors.textMuted,
  },
  dropdownModalList: {
    maxHeight: 340,
  },
  dropdownOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dropdownOptionActive: {
    backgroundColor: colors.primary,
  },
  dropdownOptionText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  dropdownOptionTextActive: {
    color: colors.surface,
    fontWeight: "700",
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    marginBottom: spacing.sm,
    lineHeight: 20,
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
    zIndex: 10,
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
