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
import { rtcEngine } from "../../../src/services/rtc/rtcEngineInstance";
import { callSignalingService } from "../../../src/services/call/callSignalingService";
import type { CallContact } from "../../../src/types/call";
import CallHeader from "../../../src/components/call/CallHeader";
import TranscriptPanel from "../../../src/components/call/TranscriptPanel";
import CallParticipantCard from "../../../src/components/call/CallParticipantCard";
import CallSummaryModal from "../../../src/components/call/CallSummaryModal";
import { callSummaryState } from "../../../src/services/callSummaryState";
import CallControls, {
  type CallControlItem,
} from "../../../src/components/call/CallControls";
import { colors } from "../../../src/theme/colors";
import { spacing } from "../../../src/theme/spacing";
import { typography } from "../../../src/theme/typography";

function getConnectionLabel(callState: string, rtcState: string) {
  if (callState === "ringing") return "Ringing";
  if (callState === "declined") return "Call declined";
  if (callState === "canceled") return "Call canceled";
  if (callState === "timeout") return "No answer";
  if (callState === "ended") return "Call ended";

  switch (rtcState) {
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
      return callState === "active" ? "Connecting" : "Preparing call";
  }
}

export default function AudioCallScreen() {
  const params = useLocalSearchParams<{ contactId: string; callId?: string }>();
  const contactId = Array.isArray(params.contactId)
    ? params.contactId[0]
    : params.contactId;
  const routeCallId = Number(
    Array.isArray(params.callId) ? params.callId[0] : params.callId
  );

  const [contact, setContact] = useState<CallContact | null>(null);
  const [contactLoading, setContactLoading] = useState(true);
  const [contactError, setContactError] = useState("");
  const [speakerOn, setSpeakerOn] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [switchingToVideo, setSwitchingToVideo] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [finalTranscriptItems, setFinalTranscriptItems] = useState<any[]>([]);
  const [finalDuration, setFinalDuration] = useState("00:00");

  useEffect(() => {
    if (!contactId) return;

    async function loadContact() {
      try {
        setContactLoading(true);
        setContactError("");
        const data = await callService.getContactById(contactId);
        setContact(data);
      } catch (err) {
        setContactError(
          err instanceof Error ? err.message : "Unable to load contact"
        );
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
  } = useCallSession(contact, "audio", {
    callId: Number.isFinite(routeCallId) ? routeCallId : undefined,
  });

  const { items: transcriptItems } = useAiTranscript(
    session?.callId,
    Boolean(session?.transcribing)
  );


  const rtcOptions =
    session && contact && session.callState === "active"
      ? {
          callId: String(session.callId),
          mode: "audio" as const,
          localUserId: String(session.patient.userId ?? session.patient.name),
          remoteUserId: String(contact.userId ?? contact.id),
          serverUrl: session.joinPayload?.livekitUrl ?? session.livekitUrl,
          accessToken: session.joinPayload?.accessToken,
        }
      : undefined;

  const rtc = useRtcEngine(rtcEngine, rtcOptions);
  const error = contactError || sessionError || rtc.error;

  useEffect(() => {
    if (!session || !contact || session.callState !== "active") return;

    const callId = String(session.callId);
    const localUserId = String(session.patient.userId ?? session.patient.name);
    const remoteUserId = String(contact.userId ?? contact.id);

    callSignalingService
      .joinCall({ callId, mode: "audio", localUserId, remoteUserId })
      .catch((err) => console.warn("[call] failed to join WS call room", err));

    return () => {
      callSignalingService
        .leaveCall({ callId, localUserId })
        .catch(() => undefined);
    };
  }, [
    session?.callId,
    session?.callState,
    session?.patient.userId,
    session?.patient.name,
    contact?.userId,
    contact?.id,
  ]);

  useEffect(() => {
    if (!session || !contact || session.mode !== "video" || switchingToVideo) return;

    setSwitchingToVideo(true);

    router.replace({
      pathname: "/call/video/[contactId]",
      params: {
        contactId: contact.id,
        callId: String(session.callId),
      },
    });
  }, [session, contact, switchingToVideo, router]);

  // On call end: show summary, then navigate away when user closes it
  useEffect(() => {
    if (!session?.ended) return;
    setFinalTranscriptItems([...transcriptItems]);
    setFinalDuration(formattedDuration);
    callSummaryState.setSummaryVisible(true);
    setShowSummary(true);
  }, [session?.ended]);

  const connectionLabel = useMemo(
    () =>
      getConnectionLabel(
        session?.callState ?? "ringing",
        rtc.snapshot.connectionState
      ),
    [session?.callState, rtc.snapshot.connectionState]
  );

  if (contactLoading || loading || (rtcOptions ? rtc.joining : false)) {
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
        <Pressable
          style={styles.backToListBtn}
          onPress={() => router.replace("/call")}
        >
          <Text style={styles.backToListText}>Back to call centre</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const audioMainControls: CallControlItem[] = [
    {
      key: "mute",
      label: muted ? "Unmute" : "Mute",
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
      label: speakerOn ? "Speaker" : "Earpiece",
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
      onPress: async () => {
        if (!session || switchingToVideo) return;
        setSwitchingToVideo(true);
        try {
          await callService.updateMode(session.callId, "video");
          router.replace({
            pathname: "/call/video/[contactId]",
            params: { contactId: contact.id, callId: String(session.callId) },
          });
        } finally {
          setSwitchingToVideo(false);
        }
      },
    },
    {
      key: "ai",
      label: transcribing ? "AI On" : "AI Off",
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
      icon: <Feather name="phone-off" size={26} color="#FFFFFF" />,
      onPress: async () => {
        setFinalTranscriptItems([...transcriptItems]);
        setFinalDuration(formattedDuration);
        callSummaryState.setSummaryVisible(true);
        setShowSummary(true);
        await endCurrentCall();
        await rtc.leaveCall();
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

  const isTerminalCall = ["declined", "canceled", "timeout", "ended"].includes(
    session.callState
  );

  return (
    <View style={styles.root}>
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
            callId: session.callId,
            contactId: contact.id,
            contactName: contact.name,
          });
          router.replace("/call");
        }}
      />

      <View style={styles.content}>
        {/* Participant card */}
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

        {/* Main controls grid */}
        <View style={styles.mainControlsWrap}>
          <CallControls items={audioMainControls} layout="grid" />
        </View>

        {/* Transcript panel — scrollable, with jump-to-latest */}
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

        {/* Connection status */}
        <View style={styles.connectionWrap}>
          <MaterialIcons
            name={
              session.callState === "ringing"
                ? "ring-volume"
                : rtc.snapshot.connectionState === "connected"
                ? "graphic-eq"
                : isTerminalCall
                ? "call-end"
                : "wifi-tethering"
            }
            size={18}
            color={isTerminalCall ? colors.danger : colors.success}
          />
          <Text
            style={[
              styles.connectionText,
              isTerminalCall && styles.connectionTextEnded,
            ]}
          >
            {connectionLabel}
          </Text>
        </View>

        {/* Bottom action row (dialpad / end / chat) */}
        <View style={styles.bottomActions}>
          <CallControls items={audioBottomControls} layout="row" />
        </View>
      </View>

      </SafeAreaView>

      {/* Post-call AI summary modal — full screen overlay outside SafeAreaView */}
      {showSummary && (
        <CallSummaryModal
          visible={showSummary}
          onClose={() => {
            callSummaryState.setSummaryVisible(false);
            setShowSummary(false);
            rtc.leaveCall().catch(() => undefined);
            router.replace("/call");
          }}
          session={session}
          contact={contact}
          transcriptItems={
            finalTranscriptItems.length > 0
              ? finalTranscriptItems
              : transcriptItems
          }
          formattedDuration={finalDuration || formattedDuration}
        />
      )}
    </View>
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
  root: {
    flex: 1,
    backgroundColor: colors.background,
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
    paddingTop: 10,
    position: "relative",
  },
  hero: {
    alignItems: "center",
    marginBottom: 12,
  },
  mainControlsWrap: {
    marginBottom: 14,
  },
  transcriptPanel: {
    height: 150,
    marginBottom: 10,
  },
  transcriptPanelExpanded: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "60%",
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