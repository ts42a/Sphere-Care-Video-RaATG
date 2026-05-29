import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { Feather } from "@expo/vector-icons";

import { useMiniCall } from "../../hooks/useMiniCall";
import { miniCallService } from "../../services/miniCallService";
import { activeCallService } from "../../services/activeCallService";
import type { CallSession } from "../../types/call";
import { colors } from "../../theme/colors";

function formatDuration(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getStatusText(session: CallSession | null, fallback?: string) {
  if (!session) return fallback ?? "Active call";
  if (session.callState === "ringing") return "Connecting";
  if (session.callState === "active") return "Live";
  if (session.callState === "ended") return "Call ended";
  return session.consultationStatus || fallback || "In call";
}

export default function MiniCallBar() {
  const pathname = usePathname();
  const miniCall = useMiniCall();
  const [session, setSession] = useState<CallSession | null>(activeCallService.get());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    return activeCallService.subscribe(setSession);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const startedAtMs = session?.startedAtMs ?? miniCall.startedAtMs;
      if (!startedAtMs) {
        setElapsedSeconds(0);
        return;
      }

      const diff = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
      setElapsedSeconds(diff);
    }, 1000);

    return () => clearInterval(interval);
  }, [session?.startedAtMs, miniCall.startedAtMs]);

  const hiddenOnCallScreen =
    pathname?.startsWith("/call/audio") || pathname?.startsWith("/call/video");

  if (
    !miniCall.active ||
    !miniCall.minimized ||
    !miniCall.contactId ||
    !miniCall.mode ||
    hiddenOnCallScreen
  ) {
    return null;
  }

  const mode = session?.mode ?? miniCall.mode;
  const contactName = miniCall.contactName || session?.doctor.name || "Active call";
  const status = getStatusText(session, miniCall.statusText);
  const durationLabel = formatDuration(elapsedSeconds);

  function reopenCall() {
    miniCallService.setState({ minimized: false });

    router.push({
      pathname: mode === "video" ? "/call/video/[contactId]" : "/call/audio/[contactId]",
      params: {
        contactId: String(miniCall.contactId),
        ...(miniCall.callId ? { callId: String(miniCall.callId) } : {}),
      },
    });
  }

  return (
    <Pressable style={styles.container} onPress={reopenCall}>
      <View style={styles.leadingBadge}>
        <Feather
          name={mode === "video" ? "video" : "phone-call"}
          size={18}
          color={colors.surface}
        />
      </View>

      <View style={styles.mainContent}>
        <View style={styles.topRow}>
          <Text style={styles.title} numberOfLines={1}>
            {contactName}
          </Text>

          <View style={styles.durationChip}>
            <Text style={styles.durationText}>{durationLabel}</Text>
          </View>
        </View>

        <View style={styles.bottomRow}>
          <View style={styles.liveDot} />
          <Text style={styles.subtitle} numberOfLines={1}>
            {status} · {mode === "video" ? "Video call" : "Audio call"}
          </Text>
        </View>
      </View>

      <View style={styles.trailing}>
        <Text style={styles.returnText}>Return</Text>
        <Feather name="chevron-up" size={18} color={colors.surface} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 16,
    minHeight: 74,
    borderRadius: 22,
    backgroundColor: "#10213F",
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  leadingBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(124, 145, 219, 0.32)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  mainContent: {
    flex: 1,
    minWidth: 0,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    flex: 1,
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
    marginRight: 10,
  },
  durationChip: {
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  durationText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: "700",
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 7,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
    marginRight: 8,
  },
  subtitle: {
    flex: 1,
    color: "#D6E2FF",
    fontSize: 12,
    fontWeight: "500",
  },
  trailing: {
    marginLeft: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  returnText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 2,
  },
});