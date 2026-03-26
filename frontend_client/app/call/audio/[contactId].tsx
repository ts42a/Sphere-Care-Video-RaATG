import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Feather, MaterialIcons, Ionicons } from "@expo/vector-icons";

import { callService } from "../../../src/services/callService";
import type { CallContact } from "../../../src/types/call";
import { colors } from "../../../src/theme/colors";
import { spacing } from "../../../src/theme/spacing";
import { typography } from "../../../src/theme/typography";

export default function AudioCallScreen() {
  const { contactId } = useLocalSearchParams<{ contactId: string }>();
  const [isConnected, setIsConnected] = useState(true);
  const [callSeconds, setCallSeconds] = useState(0);
  const [contact, setContact] = useState<CallContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);

  useEffect(() => {
    if (contactId) {
      loadContact(contactId);
      callService.startAudioCall(contactId).catch((error) => {
        console.error("Failed to start audio call", error);
      });
    }
  }, [contactId]);
  useEffect(() => {
    if (!isConnected) return;

    const timer = setInterval(() => {
      setCallSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [isConnected]);

  function formatCallTime(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  async function loadContact(id: string) {
    try {
      setLoading(true);
      const data = await callService.getContactById(id);
      setContact(data);
    } catch (error) {
      console.error("Failed to load contact", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading || !contact) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()}>
          <Feather name="arrow-left" size={26} color={colors.icon} />
        </Pressable>

        <Text style={styles.callTime}>{formatCallTime(callSeconds)}</Text>

        <Pressable>
          <Feather name="more-vertical" size={24} color={colors.icon} />
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={styles.avatarWrap}>
          <View
            style={[
              styles.avatarCircle,
              { backgroundColor: contact.avatarColor || "#D9D9D9" },
            ]}
          >
            <Text style={styles.avatarText}>{contact.initials}</Text>
          </View>
          <View style={styles.onlineDot} />
        </View>

        <Text style={styles.name}>{contact.name}</Text>
        <Text style={styles.role}>{contact.specialty}</Text>

        <View style={styles.statusPill}>
          <Text style={styles.statusText}>Connected</Text>
        </View>

        <View style={styles.grid}>
          <ControlCard
            label="Mute"
            active={muted}
            icon={
              <Feather
                name={muted ? "mic-off" : "mic"}
                size={24}
                color={colors.icon}
              />
            }
            onPress={() => setMuted((prev) => !prev)}
          />
          <ControlCard
            label="Speaker"
            active={speakerOn}
            icon={
              <Feather
                name={speakerOn ? "volume-2" : "volume-x"}
                size={24}
                color={colors.icon}
              />
            }
            onPress={() => setSpeakerOn((prev) => !prev)}
          />
          <ControlCard
            label="Video"
            icon={<Feather name="video" size={24} color={colors.icon} />}
            onPress={() =>
              router.replace({
                pathname: "/call/video/[contactId]",
                params: { contactId: contact.id },
              })
            }
          />
          <ControlCard
            label="Add"
            icon={
              <Ionicons name="person-add-outline" size={24} color={colors.icon} />
            }
            onPress={() => {}}
          />
        </View>

        <View style={styles.connectionWrap}>
          <MaterialIcons name="graphic-eq" size={28} color={colors.success} />
          <Text style={styles.connectionText}>Excellent connection</Text>
        </View>
        <View style={styles.bottomActions}>
          <Pressable style={styles.leftActionBtn}>
            <MaterialIcons name="dialpad" size={24} color={colors.icon} />
          </Pressable>

          <Pressable
            style={styles.endBtn}
            onPress={() => router.replace("/call")}
          >
            <Feather name="phone" size={28} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function ControlCard({
  label,
  icon,
  onPress,
  active,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      style={[styles.controlCard, active ? styles.controlCardActive : null]}
      onPress={onPress}
    >
      {icon}
      <Text style={styles.controlLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: 6,
    paddingHorizontal: spacing.xxl,
  },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  callTime: {
    ...typography.body,
    color: "#6C7482",
    fontSize: 16,
  },
  content: {
    flex: 1,
    justifyContent: "space-between",
    paddingBottom: 14,
  },
  avatarWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    marginBottom: 14,
  },
  avatarCircle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 40,
    fontWeight: "700",
    color: colors.surface,
  },
  onlineDot: {
    position: "absolute",
    right: 98,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#2BC35A",
    borderWidth: 4,
    borderColor: colors.background,
  },
  name: {
    textAlign: "center",
    ...typography.pageTitle,
    color: colors.textPrimary,
    marginBottom: 4,
    fontSize: 22,
  },
  role: {
    textAlign: "center",
    ...typography.body,
    color: "#6E7685",
    marginBottom: 10,
    fontSize: 14,
  },
  statusPill: {
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#E5F4EA",
    marginBottom: 18,
  },
  statusText: {
    color: "#25A34C",
    fontSize: 15,
    fontWeight: "500",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 14,
    marginBottom: 18,
  },
  controlCard: {
    width: "47%",
    height: 98,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  controlCardActive: {
    backgroundColor: "#F2F8FF",
  },
  controlLabel: {
    ...typography.body,
    color: "#586474",
    fontSize: 16,
  },
  connectionWrap: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: 18,
  },
  connectionText: {
    ...typography.body,
    fontSize: 16,
    color: colors.success,
  },
  bottomActions: {
    height: 92,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 4,
    position: "relative",
  },
  leftActionBtn: {
    position: "absolute",
    left: 40,
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#ECEDEF",
    alignItems: "center",
    justifyContent: "center",
  },
  endBtn: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "#EF2626",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
});