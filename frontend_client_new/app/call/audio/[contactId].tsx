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
          <Feather name="arrow-left" size={28} color={colors.icon} />
        </Pressable>

        <Text style={styles.callTime}>00:04</Text>

        <Pressable>
          <Feather name="more-vertical" size={26} color={colors.icon} />
        </Pressable>
      </View>

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
          icon={<Feather name="mic-off" size={28} color={colors.icon} />}
          onPress={() => setMuted((prev) => !prev)}
        />
        <ControlCard
          label="Speaker"
          active={speakerOn}
          icon={<Feather name="volume-2" size={28} color={colors.icon} />}
          onPress={() => setSpeakerOn((prev) => !prev)}
        />
        <ControlCard
          label="Video"
          icon={<Feather name="video" size={28} color={colors.icon} />}
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
            <Ionicons name="person-add-outline" size={28} color={colors.icon} />
          }
          onPress={() => {}}
        />
      </View>

      <View style={styles.connectionWrap}>
        <MaterialIcons name="graphic-eq" size={32} color={colors.success} />
        <Text style={styles.connectionText}>Excellent connection</Text>
      </View>

      <View style={styles.bottomActions}>
        <Pressable style={styles.smallBtn}>
          <MaterialIcons name="dialpad" size={28} color={colors.icon} />
        </Pressable>

        <Pressable style={styles.endBtn} onPress={() => router.replace("/call")}>
          <Feather name="phone-off" size={28} color={colors.surface} />
        </Pressable>
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
    paddingTop: 10,
    paddingHorizontal: spacing.xxxl,
  },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 34,
  },
  callTime: {
    ...typography.body,
    color: "#6C7482",
    fontSize: 18,
  },
  avatarWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
    marginBottom: spacing.xxxl,
  },
  avatarCircle: {
    width: 210,
    height: 210,
    borderRadius: 105,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 56,
    fontWeight: "700",
    color: colors.surface,
  },
  onlineDot: {
    position: "absolute",
    right: 92,
    bottom: 14,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#2BC35A",
    borderWidth: 4,
    borderColor: colors.background,
  },
  name: {
    textAlign: "center",
    ...typography.pageTitle,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  role: {
    textAlign: "center",
    ...typography.body,
    color: "#6E7685",
    marginBottom: spacing.lg,
  },
  statusPill: {
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#E5F4EA",
    marginBottom: 34,
  },
  statusText: {
    color: "#25A34C",
    fontSize: 16,
    fontWeight: "500",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: spacing.lg,
    marginBottom: spacing.xl,
  },
  controlCard: {
    width: "47%",
    height: 122,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  controlCardActive: {
    backgroundColor: "#F2F8FF",
  },
  controlLabel: {
    ...typography.body,
    color: "#586474",
    fontSize: 17,
  },
  connectionWrap: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: 34,
  },
  connectionText: {
    ...typography.body,
    fontSize: 18,
    color: colors.success,
  },
  bottomActions: {
    marginTop: "auto",
    marginBottom: 34,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 34,
  },
  smallBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#ECEDEF",
    alignItems: "center",
    justifyContent: "center",
  },
  endBtn: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#EF2626",
    alignItems: "center",
    justifyContent: "center",
  },
});