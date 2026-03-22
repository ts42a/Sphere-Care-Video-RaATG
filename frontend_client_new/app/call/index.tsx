import { useEffect, useMemo, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Feather, MaterialIcons, Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import BottomNav from "../../src/components/BottomNav";
import PageHeader from "../../src/components/PageHeader";
import { callService } from "../../src/services/callService";
import type { CallContact, CallSummary } from "../../src/types/call";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";

export default function CallCenterScreen() {
  const [query, setQuery] = useState("");
  const [summary, setSummary] = useState<CallSummary | null>(null);
  const [contacts, setContacts] = useState<CallContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadContacts(query);
    }, 220);

    return () => clearTimeout(timer);
  }, [query]);

  async function loadInitialData() {
    try {
      setLoading(true);
      setError("");
      const [summaryData, contactData] = await Promise.all([
        callService.getSummary(),
        callService.getContacts(""),
      ]);
      setSummary(summaryData);
      setContacts(contactData);
    } catch (error) {
      console.error("Failed to load call center data", error);
      setError("Unable to load call data right now.");
    } finally {
      setLoading(false);
    }
  }

  async function loadContacts(search: string) {
    try {
      setError("");
      const data = await callService.getContacts(search);
      setContacts(data);
    } catch (error) {
      console.error("Failed to load contacts", error);
      setError("Unable to search contacts.");
    }
  }

  const pendingText = useMemo(() => {
    return summary?.pendingCallsText ?? "Loading recent activity...";
  }, [summary]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader title="Call Center" />

        <View style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryTitle}>Recent Activity</Text>
              <Text style={styles.summarySubtitle}>{pendingText}</Text>
            </View>

            <View style={styles.summaryIconWrap}>
              <Feather name="phone-call" size={34} color="#C98E99" />
            </View>
          </View>

          <View style={styles.statsRow}>
            <StatBox
              label="Today"
              value={`${summary?.todayCalls ?? 0} calls`}
            />
            <StatBox
              label="Missed"
              value={`${summary?.missedCalls ?? 0} calls`}
            />
            <StatBox
              label="Duration"
              value={summary?.totalDurationLabel ?? "0m"}
            />
          </View>
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Feather name="search" size={22} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by name, ID..."
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
            />
          </View>

          <Pressable style={styles.addBtn}>
            <Ionicons name="add" size={24} color={colors.surface} />
          </Pressable>
        </View>

        {error ? (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>{error}</Text>
          </View>
        ) : null}

        {!loading && !error && contacts.length === 0 ? (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>No contacts found.</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <View style={styles.list}>
            {contacts.map((contact) => (
              <View key={contact.id} style={styles.contactCard}>
                <View
                  style={[
                    styles.avatar,
                    { backgroundColor: contact.avatarColor },
                  ]}
                >
                  <Text style={styles.avatarText}>{contact.initials}</Text>
                </View>

                <View style={styles.contactInfo}>
                  <Text style={styles.contactName}>{contact.name}</Text>
                  <Text style={styles.contactSeen}>{contact.lastSeen}</Text>
                </View>

                <View style={styles.actions}>
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/call/audio/[contactId]",
                        params: { contactId: contact.id },
                      })
                    }
                  >
                    <Feather name="phone-call" size={24} color={colors.icon} />
                  </Pressable>

                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/messages/[contactId]",
                        params: { contactId: contact.id },
                      })
                    }
                  >
                    <MaterialIcons
                      name="message"
                      size={26}
                      color={colors.icon}
                    />
                  </Pressable>

                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/call/video/[contactId]",
                        params: { contactId: contact.id },
                      })
                    }
                  >
                    <Feather name="video" size={24} color={colors.icon} />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <BottomNav active="call" />
    </SafeAreaView>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
  },
  summaryCard: {
    borderRadius: 24,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    backgroundColor: "#EDEFFF",
  },
  summaryTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.lg,
  },
  summaryTitle: {
    ...typography.sectionTitle,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  summarySubtitle: {
    ...typography.body,
    color: "#58677A",
  },
  summaryIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8EEF1",
  },
  statsRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  statBox: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: colors.surface,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    alignItems: "center",
  },
  statLabel: {
    ...typography.subText,
    color: "#667487",
    marginBottom: spacing.xs,
  },
  statValue: {
    ...typography.cardTitle,
    color: colors.textSecondary,
  },
  searchRow: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  searchBox: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    ...typography.body,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.textMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  infoBox: {
    backgroundColor: "#F1F2F4",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  infoText: {
    ...typography.subText,
    color: "#667487",
    fontSize: 15,
  },
  loaderWrap: {
    paddingTop: 40,
    alignItems: "center",
  },
  list: {
    gap: 14,
    paddingBottom: spacing.md,
  },
  contactCard: {
    borderRadius: 18,
    backgroundColor: "#F1F2F4",
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  avatarText: {
    color: colors.surface,
    fontSize: 22,
    fontWeight: "700",
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    ...typography.cardTitle,
    fontSize: 17,
    marginBottom: spacing.xs,
  },
  contactSeen: {
    ...typography.subText,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginLeft: spacing.sm,
  },
});