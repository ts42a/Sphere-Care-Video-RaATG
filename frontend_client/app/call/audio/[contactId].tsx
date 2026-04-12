import { useEffect, useMemo, useState } from "react";
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
import { miniCallService } from "../../../src/services/miniCallService";
import { useCallSession } from "../../../src/hooks/useCallSession";
import { useAiTranscript } from "../../../src/hooks/useAiTranscript";
import { useRtcEngine } from "../../../src/hooks/useRtcEngine";
import { mockRtcEngine } from "../../../src/services/rtc/mockRtcEngine";
import type { CallContact } from "../../../src/types/call";
import CallHeader from "../../../src/components/call/CallHeader";
import TranscriptPanel from "../../../src/components/call/TranscriptPanel";
import CallParticipantCard from "../../../src/components/call/CallParticipantCard";
import CallControls, {
  type CallControlItem,
} from "../../../src/components/call/CallControls";
import { colors } from "../../../src/theme/colors";
import { spacing } from "../../../src/theme/spacing";
import { typography } from "../../../src/theme/typography";

function getConnectionLabel(state: string) {
  switch (state) {
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "connected":
      return "Excellent connection";
    case "ended":
      return "Call ended";
    case "disconnected":
      return "Disconnected";
    default:
      return "Connecting";
  }
}

export default function AudioCallScreen() {
  const { contactId } = useLocalSearchParams<{ contactId: string }>();
  const [contact, setContact] = useState<CallContact | null>(null);
  const [contactLoading, setContactLoading] = useState(true);
  const [contactError, setContactError] = useState("");
  const [speakerOn, setSpeakerOn] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!contactId) return;

    async function loadContact() {
      try {
        setContactLoading(true);
        setContactError("");
        const data = await callService.getContactById(contactId);
        setContact(data);
      } catch (err) {
        setContactError(err instanceof Error ? err.message : "Unable to load contact");
      } finally {
        setContactLoading(false);
      }
    }

    loadContact();
  }, [contactId]);

  const {
    session,
    loading,
    error: sessionError,
    formattedDuration,
    muted,
    transcribing,
    toggleMute,
    stopTranscribing,
    endCurrentCall,
  } = useCallSession(contact, "audio");

  const {
    items: transcriptItems,
    transcribing: liveTranscribing,
  } = useAiTranscript(
    session?.callId,
    Boolean(session?.transcribing)
  );

  const rtc = useRtcEngine(
    mockRtcEngine,
    session && contact
      ? {
          callId: String(session.callId),
          mode: "audio",
          localUserId: session.patient.name,
          remoteUserId: contact.id,
        }
      : undefined
  );

  const error = contactError || sessionError || rtc.error;
  const connectionLabel = useMemo(
    () => getConnectionLabel(rtc.snapshot.connectionState),
    [rtc.snapshot.connectionState]
  );

  if (contactLoading || loading || rtc.joining) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!contact || !session) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <Text style={styles.errorText}>{error || "Unable to start call."}</Text>
        <Pressable style={styles.backToListBtn} onPress={() => router.replace("/call")}>
          <Text style={styles.backToListText}>Back to call center</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const audioMainControls: CallControlItem[] = [
    {
      key: "mute",
      label: "Mute",
      active: muted,
      icon: (
        <Feather
          name={muted ? "mic-off" : "mic"}
          size={22}
          color={colors.icon}
        />
      ),
      onPress: async () => {
        await rtc.setMuted(!muted);
        await toggleMute();
      },
    },
    {
      key: "speaker",
      label: "Speaker",
      active: speakerOn,
      icon: (
        <Feather
          name={speakerOn ? "volume-2" : "volume-x"}
          size={22}
          color={colors.icon}
        />
      ),
      onPress: () => setSpeakerOn((prev) => !prev),
    },
    {
      key: "video",
      label: "Video",
      icon: <Feather name="video" size={22} color={colors.icon} />,
      onPress: () =>
        router.replace({
          pathname: "/call/video/[contactId]",
          params: { contactId: contact.id },
        }),
    },
    {
      key: "ai",
      label: transcribing ? "Stop AI" : "AI Off",
      active: transcribing,
      icon: <MaterialIcons name="smart-toy" size={22} color={colors.icon} />,
      onPress: stopTranscribing,
    },
  ];

  const audioBottomControls: CallControlItem[] = [
    {
      key: "dialpad",
      label: "",
      icon: <MaterialIcons name="dialpad" size={22} color={colors.icon} />,
      onPress: () => {},
    },
    {
      key: "end",
      label: "",
      danger: true,
      icon: <Feather name="phone" size={26} color="#FFFFFF" />,
      onPress: async () => {
        await rtc.leaveCall();
        await endCurrentCall();
        router.replace("/call");
      },
    },
    {
      key: "message",
      label: "",
      icon: (
        <Ionicons
          name="chatbubble-ellipses-outline"
          size={20}
          color={colors.icon}
        />
      ),
      onPress: () =>
        router.push({
          pathname: "/messages/[contactId]",
          params: { contactId: contact.id },
        }),
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <CallHeader
        time={formattedDuration}
        aiEnabled={transcribing}
        onBack={() => router.back()}
        onMinimize={() => {
          miniCallService.setState({
            active: true,
            minimized: true,
            mode: "audio",
            contactId: contact.id,
            contactName: contact.name,
          });
          router.replace("/call");
        }}
      />

      <View style={styles.content}>
        <View style={styles.hero}>
          <CallParticipantCard
            initials={contact.initials}
            name={contact.name}
            subtitle={contact.specialty}
            status={session.consultationStatus}
            avatarColor={contact.avatarColor}
            showOnlineDot
          />
        </View>

        <View style={styles.mainControlsWrap}>
          <CallControls items={audioMainControls} layout="grid" />
        </View>

        <TranscriptPanel
          items={transcriptItems}
          transcribing={transcribing}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((prev) => !prev)}
          containerStyle={[
            styles.transcriptPanel,
            expanded ? styles.transcriptPanelExpanded : null,
          ]}
        />

        <View style={styles.connectionWrap}>
          <MaterialIcons
            name={
              rtc.snapshot.connectionState === "connected"
                ? "graphic-eq"
                : rtc.snapshot.connectionState === "ended"
                ? "call-end"
                : "wifi-tethering"
            }
            size={22}
            color={
              rtc.snapshot.connectionState === "ended"
                ? colors.danger
                : colors.success
            }
          />
          <Text
            style={[
              styles.connectionText,
              rtc.snapshot.connectionState === "ended"
                ? styles.connectionTextEnded
                : null,
            ]}
          >
            {connectionLabel}
          </Text>
        </View>

        <View style={styles.bottomActions}>
          <CallControls items={audioBottomControls} layout="row" />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xxl,
  },
  errorText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  backToListBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
  },
  backToListText: {
    color: colors.surface,
    fontWeight: "700",
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: 4,
    paddingHorizontal: 20,
  },
  content: {
    flex: 1,
    paddingBottom: 10,
    position: "relative",
    paddingTop: 10,
  },
  hero: {
    alignItems: "center",
    marginBottom: 12,
  },
  mainControlsWrap: {
    marginBottom: 16,
  },
  transcriptPanel: {
    height: 130,
    marginBottom: 10,
  },
  transcriptPanelExpanded: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "58%",
    marginBottom: 0,
    zIndex: 20,
    elevation: 12,
  },
  connectionWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    gap: 6,
  },
  connectionText: {
    ...typography.subText,
    color: colors.success,
    fontSize: 13,
  },
  connectionTextEnded: {
    color: colors.danger,
  },
  bottomActions: {
    marginTop: "auto",
    paddingTop: 4,
  },
});