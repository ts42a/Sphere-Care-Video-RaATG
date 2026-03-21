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

export default function ProfessionalInfoScreen() {
  const [profession, setProfession] = useState("");
  const [department, setDepartment] = useState("");
  const [certifications, setCertifications] = useState("");
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
      setProfession(profile.professional.profession);
      setDepartment(profile.professional.department);
      setCertifications(profile.professional.certifications);
    } catch (error) {
      setError("Failed to load professional info.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    try {
      setSaving(true);
      setError("");

      await profileService.updateProfessionalInfo({
        profession,
        department,
        certifications,
      });

      router.back();
    } catch (error) {
      setError("Failed to save professional info.");
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
          <PageHeader title="Professional Info" />

          <Text style={styles.label}>Profession</Text>
          <TextInput style={styles.input} value={profession} onChangeText={setProfession} />

          <Text style={styles.label}>Department</Text>
          <TextInput style={styles.input} value={department} onChangeText={setDepartment} />

          <Text style={styles.label}>Certifications</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            value={certifications}
            onChangeText={setCertifications}
            multiline
            textAlignVertical="top"
          />

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
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4E8ED",
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 18,
    color: "#1B2234",
    fontSize: 16,
  },
  multilineInput: {
    minHeight: 110,
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