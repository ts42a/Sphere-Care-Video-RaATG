import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Animated,
  PanResponder,
  Dimensions,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Feather, MaterialIcons, Ionicons } from "@expo/vector-icons";

import { callService } from "../../../src/services/callService";
import { miniCallService } from "../../../src/services/miniCallService";
import { useCallSession } from "../../../src/hooks/useCallSession";
import { useAiTranscript } from "../../../src/hooks/useAiTranscript";
import { useRtcEngine } from "../../../src/hooks/useRtcEngine";
import { mockRtcEngine } from "../../../src/services/rtc/mockRtcEngine";
import type { CallContact } from "../../../src/types/call";
import CallHeader from "../../../src/components/call/CallHeader";
import CallParticipantCard from "../../../src/components/call/CallParticipantCard";
import TranscriptPanel from "../../../src/components/call/TranscriptPanel";
import { colors } from "../../../src/theme/colors";
import { spacing } from "../../../src/theme/spacing";
import { typography } from "../../../src/theme/typography";

type VideoLayoutMode = "remote_focus" | "local_focus" | "split";

function getNextLayout(mode: VideoLayoutMode): VideoLayoutMode {
  if (mode === "remote_focus") return "local_focus";
  if (mode === "local_focus") return "split";
  return "remote_focus";
}

export default function VideoCallScreen() {
  const { contactId } = useLocalSearchParams<{ contactId: string }>();
  const [contact, setContact] = useState<CallContact | null>(null);
  const [contactLoading, setContactLoading] = useState(true);
  const [contactError, setContactError] = useState("");

  const [expanded, setExpanded] = useState(false);
  const [layoutMode, setLayoutMode] = useState<VideoLayoutMode>("remote_focus");

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
  } = useCallSession(contact, "video");

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
          mode: "video",
          localUserId: session.patient.name,
          remoteUserId: contact.id,
        }
      : undefined
  );

  const isLocalVideoOn = rtc.snapshot.local.videoEnabled;
  const isRemoteVideoOn = rtc.snapshot.remote.videoEnabled;
  const cameraFacing = rtc.snapshot.local.cameraFacing;

  const error = contactError || sessionError || rtc.error;

  const latestTranscript = useMemo(() => {
    if (!transcribing) return "AI transcript is paused.";
    if (transcriptItems.length === 0) return "Listening for transcript...";
    const last = transcriptItems[transcriptItems.length - 1];
    return `${last.speaker}: ${last.content}`;
  }, [transcribing, transcriptItems]);

  const screen = Dimensions.get("window");
  const dockWidth = 190;
  const dockInitialX = screen.width - dockWidth - 16;
  const dockInitialY = screen.height - 285;

  const dockPosition = useRef(
    new Animated.ValueXY({ x: dockInitialX, y: dockInitialY })
  ).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: () => {
        dockPosition.setOffset({
          x: (dockPosition.x as any)._value,
          y: (dockPosition.y as any)._value,
        });
        dockPosition.setValue({ x: 0, y: 0 });
      },

      onPanResponderMove: Animated.event(
        [null, { dx: dockPosition.x, dy: dockPosition.y }],
        { useNativeDriver: false }
      ),

      onPanResponderRelease: () => {
        dockPosition.flattenOffset();
      },
    })
  ).current;

  if (contactLoading || loading || rtc.joining) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.surface} />
      </SafeAreaView>
    );
  }

  if (!contact || !session) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <Text style={styles.errorText}>{error || "Unable to start video call."}</Text>
        <Pressable style={styles.backToListBtn} onPress={() => router.replace("/call")}>
          <Text style={styles.backToListText}>Back to call center</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.stage}>
        {layoutMode === "split" ? (
          <View style={styles.splitStage}>
            <VideoSurface
              title={contact.name}
              subtitle={contact.specialty}
              isVideoOn={isRemoteVideoOn}
              initials={contact.initials}
              avatarColor={contact.avatarColor}
              dark
              topLabel="Remote video"
            />

            <View style={styles.splitDivider} />

            <VideoSurface
              title="You"
              subtitle={cameraFacing === "front" ? "Front camera" : "Back camera"}
              isVideoOn={isLocalVideoOn}
              initials={session.patient.initials}
              avatarColor="#4C6EF5"
              dark
              topLabel="Local video"
            />
          </View>
        ) : (
          <View style={styles.fullStage}>
            <VideoSurface
              title={layoutMode === "remote_focus" ? contact.name : "You"}
              subtitle={
                layoutMode === "remote_focus"
                  ? contact.specialty
                  : cameraFacing === "front"
                  ? "Front camera"
                  : "Back camera"
              }
              isVideoOn={layoutMode === "remote_focus" ? isRemoteVideoOn : isLocalVideoOn}
              initials={layoutMode === "remote_focus" ? contact.initials : session.patient.initials}
              avatarColor={layoutMode === "remote_focus" ? contact.avatarColor : "#4C6EF5"}
              dark
              topLabel={layoutMode === "remote_focus" ? "Remote video" : "Local video"}
            />

            <View style={styles.floatingPreview}>
              <VideoSurface
                title={layoutMode === "remote_focus" ? "You" : contact.name}
                subtitle={
                  layoutMode === "remote_focus"
                    ? cameraFacing === "front"
                      ? "Front camera"
                      : "Back camera"
                    : contact.specialty
                }
                isVideoOn={layoutMode === "remote_focus" ? isLocalVideoOn : isRemoteVideoOn}
                initials={layoutMode === "remote_focus" ? session.patient.initials : contact.initials}
                avatarColor={layoutMode === "remote_focus" ? "#4C6EF5" : contact.avatarColor}
                dark
                compact
                iconOnlyWhenOff={layoutMode === "remote_focus"}
                topLabel={layoutMode === "remote_focus" ? "You" : contact.name}
              />
            </View>
          </View>
        )}

        <View style={styles.topOverlay}>
          <CallHeader
            time={formattedDuration}
            aiEnabled={transcribing}
            dark
            onBack={() => router.back()}
          />
        </View>

        <View style={styles.topRightActions}>
          <Pressable
            style={styles.cornerIconBtn}
            onPress={() => setLayoutMode((prev) => getNextLayout(prev))}
          >
            <MaterialIcons name="splitscreen" size={18} color={colors.surface} />
          </Pressable>

          <Pressable
            style={styles.cornerIconBtn}
            onPress={() => {
              miniCallService.setState({
                active: true,
                minimized: true,
                mode: "video",
                contactId: contact.id,
                contactName: contact.name,
              });
              router.replace("/call");
            }}
          >
            <MaterialIcons
              name="picture-in-picture-alt"
              size={18}
              color={colors.surface}
            />
          </Pressable>
        </View>

        {expanded ? (
          <View style={styles.expandedTranscriptWrap}>
            <TranscriptPanel
              items={transcriptItems}
              transcribing={transcribing}
              expanded={expanded}
              onToggleExpanded={() => setExpanded(false)}
              containerStyle={styles.transcriptExpandedPanel}
            />
          </View>
        ) : (
          <Animated.View
            style={[
              styles.transcriptDock,
              {
                transform: dockPosition.getTranslateTransform(),
              },
            ]}
            {...panResponder.panHandlers}
          >
            <Pressable onPress={() => setExpanded(true)}>
              <View style={styles.transcriptDockHeader}>
                <View style={styles.transcriptDockTitleRow}>
                  <MaterialIcons name="smart-toy" size={16} color={colors.surface} />
                  <Text style={styles.transcriptDockTitle}>AI Transcript</Text>
                </View>
                <Feather name="chevron-up" size={16} color="#DCE3FF" />
              </View>

              <Text style={styles.transcriptDockText} numberOfLines={1}>
                {latestTranscript}
              </Text>
            </Pressable>
          </Animated.View>
        )}

        <View style={styles.bottomOverlay}>
          <View style={styles.bottomControls}>
            <VideoActionButton
              label="Mute"
              icon={
                <Feather
                  name={muted ? "mic-off" : "mic"}
                  size={22}
                  color={colors.surface}
                />
              }
              onPress={async () => {
                await rtc.setMuted(!muted);
                await toggleMute();
              }}
            />

            <VideoActionButton
              label="Camera"
              icon={
                <Feather
                  name={isLocalVideoOn ? "video" : "video-off"}
                  size={22}
                  color={colors.surface}
                />
              }
              onPress={() => rtc.setCameraEnabled(!isLocalVideoOn)}
            />

            <VideoActionButton
              label="End"
              danger
              icon={<Feather name="phone" size={24} color={colors.surface} />}
              onPress={async () => {
                await rtc.leaveCall();
                await endCurrentCall();
                router.replace("/call");
              }}
            />

            <VideoActionButton
              label="Flip"
              icon={
                <Ionicons
                  name="camera-reverse-outline"
                  size={22}
                  color={colors.surface}
                />
              }
              onPress={() => rtc.switchCamera()}
            />

            <VideoActionButton
              label={transcribing ? "Stop AI" : "AI Off"}
              icon={<MaterialIcons name="smart-toy" size={22} color={colors.surface} />}
              onPress={stopTranscribing}
            />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function VideoSurface({
  title,
  subtitle,
  isVideoOn,
  initials,
  avatarColor,
  dark,
  compact = false,
  topLabel,
  iconOnlyWhenOff = false,
}: {
  title: string;
  subtitle: string;
  isVideoOn: boolean;
  initials: string;
  avatarColor: string;
  dark?: boolean;
  compact?: boolean;
  topLabel: string;
  iconOnlyWhenOff?: boolean;
}) {
  if (!isVideoOn && compact && iconOnlyWhenOff) {
    return (
      <View style={styles.previewOffOnly}>
        <Feather name="video-off" size={22} color={colors.surface} />
      </View>
    );
  }

  if (isVideoOn) {
    return (
      <View style={[styles.videoSurface, compact ? styles.videoSurfaceCompact : null]}>
        <Text style={[styles.videoTopLabel, compact ? styles.videoTopLabelCompact : null]}>
          {topLabel}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.videoFallbackSurface, compact ? styles.videoFallbackCompact : null]}>
      <CallParticipantCard
        initials={initials}
        name={title}
        subtitle={`${subtitle} • Camera off`}
        avatarColor={avatarColor}
        dark={dark}
        large={!compact}
      />
    </View>
  );
}

function VideoActionButton({
  label,
  icon,
  onPress,
  danger,
}: {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <View style={styles.actionItem}>
      <Pressable
        onPress={onPress}
        style={[styles.actionButton, danger ? styles.actionButtonDanger : null]}
      >
        {icon}
      </Pressable>
      <Text style={styles.actionLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: "#081936",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xxl,
  },
  errorText: {
    ...typography.body,
    color: colors.surface,
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
    backgroundColor: "#081936",
  },
  stage: {
    flex: 1,
    position: "relative",
    backgroundColor: "#081936",
  },
  fullStage: {
    ...StyleSheet.absoluteFillObject,
  },
  splitStage: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#081936",
  },
  splitDivider: {
    height: 2,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  videoSurface: {
    flex: 1,
    backgroundColor: "#17315C",
    justifyContent: "flex-end",
  },
  videoSurfaceCompact: {
    backgroundColor: "#29467C",
  },
  videoTopLabel: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "700",
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  videoTopLabelCompact: {
    fontSize: 12,
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  videoFallbackSurface: {
    flex: 1,
    backgroundColor: "#12284E",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  videoFallbackCompact: {
    paddingHorizontal: 10,
  },
  previewOffOnly: {
    flex: 1,
    backgroundColor: "#1A2F56",
    alignItems: "center",
    justifyContent: "center",
  },
  floatingPreview: {
    position: "absolute",
    top: 98,
    left: 14,
    width: 104,
    height: 148,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "#1A2F56",
  },
  topOverlay: {
    position: "absolute",
    top: 8,
    left: 14,
    right: 14,
    zIndex: 20,
  },
  topRightActions: {
    position: "absolute",
    top: 58,
    right: 14,
    flexDirection: "row",
    gap: 8,
    zIndex: 21,
  },
  cornerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(0,0,0,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  transcriptDock: {
    position: "absolute",
    width: 190,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(0,0,0,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    zIndex: 22,
  },
  transcriptDockHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  transcriptDockTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  transcriptDockTitle: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: "700",
  },
  transcriptDockText: {
    color: "#DCE3FF",
    fontSize: 12,
    lineHeight: 16,
  },
  expandedTranscriptWrap: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 108,
    zIndex: 25,
  },
  transcriptExpandedPanel: {
    height: 260,
  },
  bottomOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 10,
    paddingBottom: 10,
    zIndex: 20,
  },
  bottomControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    backgroundColor: "rgba(0,0,0,0.18)",
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 6,
    borderRadius: 24,
  },
  actionItem: {
    alignItems: "center",
    flex: 1,
  },
  actionButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  actionButtonDanger: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.danger,
  },
  actionLabel: {
    color: "#DCE3FF",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
});