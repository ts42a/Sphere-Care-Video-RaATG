import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
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

import PageHeader from "../../src/components/PageHeader";
import { profileService } from "../../src/services/profileService";

export default function PersonalDetailsScreen() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const profile = await profileService.getProfile();
      setFirstName(profile.personal.firstName);
      setLastName(profile.personal.lastName);
      setDateOfBirth(profile.personal.dateOfBirth);
      setGender(profile.personal.gender);
    } catch (error) {
      setError("Failed to load personal details.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    try {
      setSaving(true);
      setError("");

      await profileService.updatePersonalDetails({
        firstName,
        lastName,
        dateOfBirth,
        gender,
      });

      router.back();
    } catch (error) {
      setError("Failed to save personal details.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#7C91DB" />
      </SafeAreaView>
    );
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
          <PageHeader title="Personal Details" />

          <Text style={styles.label}>First Name</Text>
          <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} />

          <Text style={styles.label}>Last Name</Text>
          <TextInput style={styles.input} value={lastName} onChangeText={setLastName} />

          <Text style={styles.label}>Date of Birth</Text>
          <TextInput
            style={styles.input}
            value={dateOfBirth}
            onChangeText={setDateOfBirth}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#9AA3AF"
          />

          <Text style={styles.label}>Gender</Text>
          <TextInput style={styles.input} value={gender} onChangeText={setGender} />

          {!!error && <Text style={styles.errorText}>{error}</Text>}

          <Pressable style={styles.saveBtn} onPress={handleSave} disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveBtnText}>Save Changes</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: "#F3F4F6",
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    flex: 1,
    backgroundColor: "#F3F4F6",
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1B2234",
    marginBottom: 10,
  },
  input: {
    height: 56,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4E8ED",
    paddingHorizontal: 16,
    marginBottom: 18,
    color: "#1B2234",
    fontSize: 16,
  },
  errorText: {
    color: "#D9534F",
    marginBottom: 12,
  },
  saveBtn: {
    height: 56,
    borderRadius: 14,
    backgroundColor: "#7C91DB",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  saveBtnText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },
});