import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router } from "expo-router";

import PageHeader from "../../src/components/PageHeader";
import { profileService } from "../../src/services/profileService";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";
import type { UserProfile } from "../../src/types/profile";

export default function ProfileScreen() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    try {
      setLoading(true);
      const data = await profileService.getProfile();
      setProfile(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function handleTogglePushNotifications(nextValue: boolean) {
    if (!profile) return;

    try {
      setBusy(true);

      setProfile({
        ...profile,
        preferences: {
          ...profile.preferences,
          pushNotifications: nextValue,
        },
      });

      const updated = await profileService.updatePreferences({
        pushNotifications: nextValue,
      });

      setProfile(updated);
    } catch {
      Alert.alert("Error", "Failed to update");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !profile) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <PageHeader title="Profile Settings" />

        <View style={styles.contactRow}>
          <View style={styles.card}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{profile.contact.email}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Phone</Text>
            <Text style={styles.value}>{profile.contact.phone}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Communication</Text>

        <View style={styles.section}>
          <Pressable onPress={() => router.push("/messages")} style={styles.row}>
            <Text style={styles.rowTitle}>Messages</Text>
          </Pressable>

          <View style={styles.divider} />

          <Pressable onPress={() => router.push("/notifications")} style={styles.row}>
            <Text style={styles.rowTitle}>Notifications</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Preferences</Text>

        <View style={styles.section}>
          <View style={styles.rowBetween}>
            <Text style={styles.rowTitle}>Push Notifications</Text>

            <Switch
              value={profile.preferences.pushNotifications}
              onValueChange={handleTogglePushNotifications}
              trackColor={{ false: colors.border, true: colors.successLight }}
              thumbColor={colors.success}
              disabled={busy}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundAlt,
  },
  loading: {
    flex: 1,
    backgroundColor: colors.backgroundAlt,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  contactRow: {
    flexDirection: "row",
    gap: spacing.lg,
    marginBottom: spacing.xxxl,
  },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    ...typography.subText,
    marginBottom: spacing.sm,
  },
  value: {
    ...typography.cardTitle,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    marginBottom: spacing.md,
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xxxl,
  },
  row: {
    padding: spacing.lg,
  },
  rowBetween: {
    padding: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowTitle: {
    ...typography.body,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
});