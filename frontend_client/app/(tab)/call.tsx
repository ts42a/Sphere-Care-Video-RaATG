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

import PageHeader from "../../src/components/PageHeader";
import { callService } from "../../src/services/callService";
import { miniCallService } from "../../src/services/miniCallService";
import { wsClient } from "../../src/services/wsClient";
import type { CallContact, CallSummary } from "../../src/types/call";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";

function formatRelativeTime(value?: string, nowMs = Date.now()) {
  if (!value) return "Recently active";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently active";

  const diffMs = nowMs - date.getTime();
  if (diffMs < 0) return "Recently active";

  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} d ago`;

  return date.toLocaleDateString();
}

export default function CallCenterScreen() {
  const [query, setQuery] = useState("");
  const [summary, setSummary] = useState<CallSummary | null>(null);
  const [contacts, setContacts] = useState<CallContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [startingCallKey, setStartingCallKey] = useState("");
  const [nowTick, setNowTick] = useState(Date.now());

  const deviceTimeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadContacts(query);
    }, 220);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick(Date.now());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    let unsubscribeNewMessage = () => {};
    let unsubscribeConversationsUpdate = () => {};
    let unsubscribeCallAccepted = () => {};
    let unsubscribeCallEnded = () => {};
    let unsubscribeCallCanceled = () => {};
    let unsubscribeCallDeclined = () => {};
    let unsubscribeCallTimeout = () => {};

    async function setupRealtime() {
      try {
        await wsClient.connect();
        if (cancelled) return;

        unsubscribeNewMessage = wsClient.subscribe("new_message", () => {
          void loadContacts(query);
        });

        unsubscribeConversationsUpdate = wsClient.subscribe(
          "conversations_update",
          () => {
            void loadContacts(query);
          }
        );

        const refreshAll = () => {
          void refreshSummary();
          void loadContacts(query);
        };

        unsubscribeCallAccepted = wsClient.subscribe("call.accepted", refreshAll);
        unsubscribeCallEnded = wsClient.subscribe("call.ended", refreshAll);
        unsubscribeCallCanceled = wsClient.subscribe("call.canceled", refreshAll);
        unsubscribeCallDeclined = wsClient.subscribe("call.declined", refreshAll);
        unsubscribeCallTimeout = wsClient.subscribe("call.timeout", refreshAll);
      } catch (realtimeError) {
        console.error("Failed to connect call center realtime", realtimeError);
      }
    }

    void setupRealtime();

    return () => {
      cancelled = true;
      unsubscribeNewMessage();
      unsubscribeConversationsUpdate();
      unsubscribeCallAccepted();
      unsubscribeCallEnded();
      unsubscribeCallCanceled();
      unsubscribeCallDeclined();
      unsubscribeCallTimeout();
    };
  }, [query]);

  async function refreshSummary() {
    try {
      const summaryData = await callService.getSummary(deviceTimeZone);
      setSummary(summaryData);
    } catch (summaryError) {
      console.error("Failed to refresh call summary", summaryError);
    }
  }

  async function loadInitialData() {
    try {
      setLoading(true);
      setError("");

      const [summaryData, contactData] = await Promise.all([
        callService.getSummary(deviceTimeZone),
        callService.getContacts(""),
      ]);

      setSummary(summaryData);
      setContacts(contactData);
    } catch (loadError) {
      console.error("Failed to load call center data", loadError);
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
    } catch (loadError) {
      console.error("Failed to load contacts", loadError);
      setError("Unable to search contacts.");
    }
  }

  const pendingText = useMemo(() => {
    if (summary?.pendingCallsText) {
      return summary.pendingCallsText;
    }

    if (contacts.length > 0) {
      return `${contacts.length} care team contact${contacts.length > 1 ? "s" : ""} available`;
    }

    return "No callable contacts yet";
  }, [summary, contacts.length]);

  async function handleStartCall(contact: CallContact, mode: "audio" | "video") {
    const callKey = `${contact.id}-${mode}`;
    if (startingCallKey) return;

    try {
      setStartingCallKey(callKey);
      setError("");

      const session = await callService.startCall({ mode, contact });

      miniCallService.setState({
        active: true,
        minimized: false,
        mode,
        callId: session.callId,
        contactId: contact.id,
        contactName: contact.name,
        startedAtMs: session.startedAtMs,
        statusText: session.consultationStatus,
      });

      router.push({
        pathname:
          mode === "video" ? "/call/video/[contactId]" : "/call/audio/[contactId]",
        params: {
          contactId: contact.id,
          callId: String(session.callId),
        },
      });

      void refreshSummary();
    } catch (callError) {
      console.error("Failed to start call", callError);
      setError(
        callError instanceof Error
          ? callError.message
          : "Unable to start call right now."
      );
    } finally {
      setStartingCallKey("");
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader title="Call Center" showBack={false} />

        <View style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <View style={styles.summaryTextWrap}>
              <Text style={styles.summaryTitle}>Recent Activity</Text>
              <Text style={styles.summarySubtitle}>{pendingText}</Text>
            </View>

            <View style={styles.summaryIconWrap}>
              <Feather name="phone-call" size={34} color="#948EC9" />
            </View>
          </View>

          <View style={styles.statsRow}>
            <StatBox label="Today" value={`${summary?.todayCalls ?? 0} calls`} />
            <StatBox label="Missed" value={`${summary?.missedCalls ?? 0} calls`} />
            <StatBox label="Duration" value={summary?.totalDurationLabel ?? "0m"} />
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

          <Pressable style={[styles.addBtn, styles.addBtnDisabled]} disabled>
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
                  <Text style={styles.contactSeen}>
                    {formatRelativeTime(contact.lastSeenAt, nowTick)}
                  </Text>
                </View>

                <View style={styles.actions}>
                  <Pressable
                    disabled={Boolean(startingCallKey)}
                    onPress={() => handleStartCall(contact, "audio")}
                    style={startingCallKey ? styles.disabledAction : undefined}
                  >
                    {startingCallKey === `${contact.id}-audio` ? (
                      <ActivityIndicator size="small" color={colors.icon} />
                    ) : (
                      <Feather name="phone-call" size={24} color={colors.icon} />
                    )}
                  </Pressable>

                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/messages/[contactId]",
                        params: {
                          contactId: contact.id,
                          name: contact.name,
                          role: contact.role || contact.specialty || "Care team",
                        },
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
                    disabled={Boolean(startingCallKey)}
                    onPress={() => handleStartCall(contact, "video")}
                    style={startingCallKey ? styles.disabledAction : undefined}
                  >
                    {startingCallKey === `${contact.id}-video` ? (
                      <ActivityIndicator size="small" color={colors.icon} />
                    ) : (
                      <Feather name="video" size={24} color={colors.icon} />
                    )}
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
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
    paddingBottom: 96,
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
  summaryTextWrap: {
    flex: 1,
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
  addBtnDisabled: {
    opacity: 0.4,
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
  disabledAction: {
    opacity: 0.45,
  },
});