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
    } catch (err) {
      console.error("Failed to load call center data", err);
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
    } catch (err) {
      console.error("Failed to load contacts", err);
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
              <Feather name="phone-call" size={36} color="#F1C9D0" />
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
            <Feather name="search" size={22} color="#9AA3AF" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by name, ID..."
              placeholderTextColor="#A8AFBA"
              style={styles.searchInput}
            />
          </View>

          <Pressable style={styles.addBtn}>
            <Ionicons name="add" size={24} color="#FFFFFF" />
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
            <ActivityIndicator size="large" color="#425266" />
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
                    <Feather name="phone-call" size={26} color="#74808E" />
                  </Pressable>

                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/messages/[contactId]",
                        params: { contactId: contact.id },
                      })
                    }
                  >
                    <MaterialIcons name="message" size={28} color="#74808E" />
                  </Pressable>

                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/call/video/[contactId]",
                        params: { contactId: contact.id },
                      })
                    }
                  >
                    <Feather name="video" size={26} color="#74808E" />
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
    backgroundColor: "#F7F7F7",
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 20,
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  summaryCard: {
    borderRadius: 24,
    padding: 20,
    marginBottom: 22,
    backgroundColor: "#EDEFFF",
  },
  summaryTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 18,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#425266",
    marginBottom: 6,
  },
  summarySubtitle: {
    fontSize: 15,
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
    gap: 12,
  },
  statBox: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  statLabel: {
    fontSize: 14,
    color: "#667487",
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#425266",
  },
  searchRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    marginBottom: 20,
  },
  searchBox: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0E4EA",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    color: "#425266",
    fontSize: 16,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#97A0AD",
    alignItems: "center",
    justifyContent: "center",
  },
  infoBox: {
    backgroundColor: "#F1F2F4",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  infoText: {
    color: "#667487",
    fontSize: 15,
  },
  loaderWrap: {
    paddingTop: 40,
    alignItems: "center",
  },
  list: {
    gap: 14,
    paddingBottom: 16,
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
    marginRight: 14,
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 17,
    fontWeight: "700",
    color: "#425266",
    marginBottom: 4,
  },
  contactSeen: {
    fontSize: 14,
    color: "#99A1AC",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    marginLeft: 8,
  },
});