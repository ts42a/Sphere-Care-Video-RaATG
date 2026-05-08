import { useEffect, useMemo, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";

import PageHeader from "../../src/components/PageHeader";
import { profileService } from "../../src/services/profileService";
import { getStoredUser } from "../../src/services/sessionService";
import type { UserProfile } from "../../src/types/profile";
import type { AuthUser } from "../../src/types/auth";

function getInitials(name?: string) {
  const parts = String(name || "User")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatRole(role?: string) {
  if (!role) return "Client";

  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatStatus(status?: string) {
  if (!status) return "Active";

  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value?: string) {
  if (!value) return "Not available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function displayValue(value?: string | number | null) {
  if (value === undefined || value === null || value === "") {
    return "Not added";
  }

  return String(value);
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    try {
      setLoading(true);

      const [profileData, storedUser] = await Promise.all([
        profileService.getProfile(),
        getStoredUser<AuthUser>(),
      ]);

      setProfile(profileData);
      setAuthUser(storedUser);
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Failed to load profile.");
    } finally {
      setLoading(false);
    }
  }

  const mergedProfile = useMemo(() => {
    const fullName =
      authUser?.full_name || profile?.fullName || "Sphere Care User";

    const email = authUser?.email || profile?.contact?.email || "";
    const phone = authUser?.phone || profile?.contact?.phone || "";
    const role = authUser?.role || "client";
    const status = authUser?.account_status || "active";
    const userId = authUser?.id || profile?.id;
    const uniqueCode = authUser?.unique_code;
    const createdAt = authUser?.created_at;

    return {
      fullName,
      email,
      phone,
      role,
      status,
      userId,
      uniqueCode,
      createdAt,
      initials: getInitials(fullName),
    };
  }, [authUser, profile]);

  if (loading || !profile) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator size="large" color="#46576D" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader title="Profile" />

        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{mergedProfile.initials}</Text>
            </View>

            <View style={styles.heroTextArea}>
              <Text style={styles.nameText}>{mergedProfile.fullName}</Text>

              <View style={styles.badgeRow}>
                <View style={styles.roleBadge}>
                  <Feather name="user" size={13} color="#46576D" />
                  <Text style={styles.roleBadgeText}>
                    {formatRole(mergedProfile.role)}
                  </Text>
                </View>

                <View style={styles.statusBadge}>
                  <View style={styles.statusDot} />
                  <Text style={styles.statusBadgeText}>
                    {formatStatus(mergedProfile.status)}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.heroDivider} />

          <View style={styles.heroMetaGrid}>
            <View style={styles.heroMetaItem}>
              <Text style={styles.metaLabel}>Account ID</Text>
              <Text style={styles.metaValue}>
                {displayValue(mergedProfile.uniqueCode || mergedProfile.userId)}
              </Text>
            </View>

            <View style={styles.heroMetaItem}>
              <Text style={styles.metaLabel}>Member since</Text>
              <Text style={styles.metaValue}>
                {formatDate(mergedProfile.createdAt)}
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Contact information</Text>

        <View style={styles.infoGrid}>
          <View style={styles.infoCard}>
            <View style={styles.infoIcon}>
              <Feather name="mail" size={18} color="#46576D" />
            </View>

            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue} numberOfLines={2}>
              {displayValue(mergedProfile.email)}
            </Text>
          </View>

          <View style={styles.infoCard}>
            <View style={styles.infoIcon}>
              <Feather name="phone" size={18} color="#46576D" />
            </View>

            <Text style={styles.infoLabel}>Phone</Text>
            <Text style={styles.infoValue} numberOfLines={2}>
              {displayValue(mergedProfile.phone)}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Profile details</Text>

        <View style={styles.sectionCard}>
          <ProfileRow
            icon="user"
            title="Personal details"
            subtitle="Name, date of birth and gender"
            onPress={() => router.push("/profile/personal-details")}
          />

          <Divider />

          <ProfileRow
            icon="phone"
            title="Contact information"
            subtitle="Email address and phone number"
            onPress={() => router.push("/profile/contact-information")}
          />

          <Divider />

          <ProfileRow
            icon="briefcase"
            title="Care profile"
            subtitle="Care role, department and profile details"
            onPress={() => router.push("/profile/professional-info")}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function ProfileRow({
  icon,
  title,
  subtitle,
  rightText,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle: string;
  rightText?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={styles.rowIcon}>
        <Feather name={icon} size={18} color="#46576D" />
      </View>

      <View style={styles.rowTextArea}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>

      {rightText ? (
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{rightText}</Text>
        </View>
      ) : null}

      <Feather name="chevron-right" size={20} color="#9AA5B5" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F7F7",
  },
  loading: {
    flex: 1,
    backgroundColor: "#F7F7F7",
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 36,
  },
  heroCard: {
    backgroundColor: "#F1F3F6",
    borderRadius: 28,
    padding: 20,
    marginTop: 24,
    marginBottom: 28,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: "#46576D",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  avatarText: {
    fontSize: 24,
    fontFamily: "Montserrat-Bold",
    color: "#FFFFFF",
  },
  heroTextArea: {
    flex: 1,
  },
  nameText: {
    fontSize: 22,
    fontFamily: "Montserrat-Bold",
    color: "#1D2740",
    marginBottom: 10,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E6EBF1",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  roleBadgeText: {
    marginLeft: 5,
    fontSize: 12,
    fontFamily: "OpenSans-Regular",
    color: "#46576D",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E9F7EF",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#1DBB75",
    marginRight: 6,
  },
  statusBadgeText: {
    fontSize: 12,
    fontFamily: "OpenSans-Regular",
    color: "#227B4F",
  },
  heroDivider: {
    height: 1,
    backgroundColor: "#DDE3EA",
    marginVertical: 18,
  },
  heroMetaGrid: {
    flexDirection: "row",
    gap: 12,
  },
  heroMetaItem: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
  },
  metaLabel: {
    fontSize: 12,
    fontFamily: "OpenSans-Regular",
    color: "#7A8798",
    marginBottom: 6,
  },
  metaValue: {
    fontSize: 15,
    fontFamily: "Montserrat-Bold",
    color: "#1D2740",
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: "Montserrat-Bold",
    color: "#1D2740",
    marginBottom: 12,
  },
  infoGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 28,
  },
  infoCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "#ECEEF1",
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F1F3F6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 13,
    fontFamily: "OpenSans-Regular",
    color: "#7A8798",
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 14,
    fontFamily: "Montserrat-Bold",
    color: "#1D2740",
    lineHeight: 20,
  },
  sectionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#ECEEF1",
    marginBottom: 28,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F1F3F6",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },
  rowTextArea: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontFamily: "Montserrat-Bold",
    color: "#1D2740",
    marginBottom: 4,
  },
  rowSubtitle: {
    fontSize: 13,
    fontFamily: "OpenSans-Regular",
    color: "#7A8798",
    lineHeight: 18,
  },
  countBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#F1F3F6",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    marginRight: 8,
  },
  countBadgeText: {
    fontSize: 12,
    fontFamily: "Montserrat-Bold",
    color: "#46576D",
  },
  divider: {
    height: 1,
    backgroundColor: "#ECEEF1",
    marginLeft: 67,
  },
  pressed: {
    opacity: 0.72,
  },
});
