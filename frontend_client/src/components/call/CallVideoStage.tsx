import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from "react-native";
import { Feather, Ionicons, MaterialIcons } from "@expo/vector-icons";
import { captureRef } from "react-native-view-shot";
import * as LiveKit from "@livekit/react-native";
import { Track } from "livekit-client";

import TranscriptPanel from "./TranscriptPanel";
import { useAslBroadcast } from "../../hooks/useAslBroadcast";
import { colors } from "../../theme/colors";
import type { CallContact, CallSession, TranscriptItem } from "../../types/call";

const VideoTrackComponent: any = (LiveKit as any).VideoTrack;
const useTracksHook = (((LiveKit as any).useTracks ?? (() => [])) as unknown) as (
  sources: any
) => any[];
const useRoomContextHook = (((LiveKit as any).useRoomContext ??
  (() => null)) as unknown) as () => any;
const isTrackReferenceValue = (((LiveKit as any).isTrackReference ??
  (() => false)) as unknown) as (value: any) => boolean;

type TrackReferenceLike = any;

type TranscriptViewItem = TranscriptItem;
type TranscriptMode = "speech" | "asl";
type AslGestureMode = "static" | "motion";

const ASL_FRAME_INTERVAL_MS = 500;
const ASL_FRAME_WIDTH = 320;
const ASL_FRAME_HEIGHT = 240;

type CallVideoStageProps = {
  contact: CallContact;
  session: CallSession;
  formattedDuration: string;
  transcribing: boolean;
  transcriptItems: TranscriptViewItem[];
  expanded: boolean;
  setExpanded: (value: boolean) => void;
  onEnd: () => Promise<void>;
};

function formatStatus(session: CallSession) {
  if (session.callState === "ringing") return "Ringing";
  if (session.callState === "active") return "Connected";
  if (session.callState === "declined") return "Call declined";
  if (session.callState === "canceled") return "Call canceled";
  if (session.callState === "timeout") return "No answer";
  if (session.callState === "ended") return "Call ended";
  return session.consultationStatus || "Connecting";
}

export default function CallVideoStage({
  contact,
  session,
  formattedDuration,
  transcribing,
  transcriptItems,
  expanded,
  setExpanded,
  onEnd,
}: CallVideoStageProps) {
  const room = useRoomContextHook();
  const tracks = useTracksHook([
    { source: Track.Source.Camera, withPlaceholder: false },
  ]) as TrackReferenceLike[];

  const [cameraFacing, setCameraFacing] = useState<"front" | "back">("front");
  const [muted, setMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [transcriptMode, setTranscriptMode] = useState<TranscriptMode>("speech");
  const [aslMode, setAslMode] = useState<AslGestureMode>("static");
  const [hiddenAslSegmentIds, setHiddenAslSegmentIds] = useState<Set<string>>(
    () => new Set()
  );
  const [manualAslSpaces, setManualAslSpaces] = useState(0);
  const localPreviewRef = useRef<View | null>(null);
  const captureWarnedRef = useRef(false);

  const aslCaptureActive = Boolean(
    session.callState === "active" && transcriptMode === "asl"
  );

  const { sendFrame, lastSegment } = useAslBroadcast(session.callId, {
    enabled: aslCaptureActive,
  });

  const remoteParticipants = useMemo(
    () => Array.from(room?.remoteParticipants?.values?.() ?? []),
    [room, tracks]
  );

  const remoteTrackRef = useMemo(
    () =>
      tracks.find(
        (item: any) => isTrackReferenceValue(item) && !item.participant?.isLocal
      ) ?? null,
    [tracks]
  );

  const localTrackFromHook = useMemo(
    () =>
      tracks.find(
        (item: any) => isTrackReferenceValue(item) && item.participant?.isLocal
      ) ?? null,
    [tracks]
  );

  const localPreviewTrackRef = useMemo(() => {
    const camPub =
      room?.localParticipant?.getTrackPublication?.(Track.Source.Camera) ?? null;

    if (localTrackFromHook) {
      return localTrackFromHook;
    }

    const hasUsableVideoTrack = Boolean(
      camPub && !camPub.isMuted && (camPub.videoTrack || camPub.track)
    );

    if (!room?.localParticipant || !camPub || !hasUsableVideoTrack) {
      return null;
    }

    return {
      participant: room.localParticipant,
      publication: camPub,
      source: Track.Source.Camera,
    } as any;
  }, [localTrackFromHook, room, tracks.length]);

  const syncLocalMediaState = () => {
    const camPub =
      room?.localParticipant?.getTrackPublication?.(Track.Source.Camera) ?? null;
    const micPub =
      room?.localParticipant?.getTrackPublication?.(Track.Source.Microphone) ?? null;

    const cameraIsOn = Boolean(
      camPub && !camPub.isMuted && (camPub.videoTrack || camPub.track)
    );

    const micIsMuted = Boolean(micPub?.isMuted);

    setCameraEnabled(cameraIsOn);
    setMuted(micIsMuted);
  };

  useEffect(() => {
    let cancelled = false;

    async function ensureInitialLocalPreview() {
      if (!room?.localParticipant) return;
      if (session.mode !== "video") return;

      try {
        await room.localParticipant.setCameraEnabled?.(true);
      } catch (error) {
        console.warn("Failed to prime local camera", error);
      }

      const t1 = setTimeout(() => {
        if (!cancelled) syncLocalMediaState();
      }, 250);

      const t2 = setTimeout(() => {
        if (!cancelled) syncLocalMediaState();
      }, 800);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }

    const cleanupPromise = ensureInitialLocalPreview();

    const interval = setInterval(() => {
      syncLocalMediaState();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);

      Promise.resolve(cleanupPromise).then((cleanup) => {
        if (typeof cleanup === "function") cleanup();
      });
    };
  }, [room, session.callId, session.mode]);

  const hasRemoteParticipant = remoteParticipants.length > 0;
  const hasRemoteVideo = !!remoteTrackRef;
  const hasLocalVideo = !!localPreviewTrackRef && cameraEnabled;

  useEffect(() => {
    const canCaptureAslFrame = Boolean(aslCaptureActive && hasLocalVideo);

    if (!canCaptureAslFrame) {
      captureWarnedRef.current = false;
      return;
    }

    let stopped = false;
    let inFlight = false;

    const captureAndSendFrame = async () => {
      if (stopped || inFlight || !localPreviewRef.current) return;

      inFlight = true;

      try {
        const imageB64 = await captureRef(localPreviewRef.current, {
          format: "jpg",
          quality: 0.6,
          result: "base64",
          width: ASL_FRAME_WIDTH,
          height: ASL_FRAME_HEIGHT,
        });

        if (!stopped && imageB64) {
          sendFrame(imageB64, aslMode);
          captureWarnedRef.current = false;
        }
      } catch (error) {
        if (!captureWarnedRef.current) {
          console.warn("[ASL] Failed to capture local video frame", error);
          captureWarnedRef.current = true;
        }
      } finally {
        inFlight = false;
      }
    };

    void captureAndSendFrame();
    const interval = setInterval(captureAndSendFrame, ASL_FRAME_INTERVAL_MS);

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [aslCaptureActive, aslMode, hasLocalVideo, sendFrame]);

  const visibleTranscriptItems = useMemo(() => {
    const activeItems = transcriptItems.filter((item) => {
      const isAsl = item.source === "asl" || item.content.startsWith("[ASL]");
      return transcriptMode === "asl" ? isAsl : !isAsl;
    });

    if (transcriptMode !== "asl") return activeItems;

    return activeItems.filter((item) => {
      const segmentKey = item.segmentId ?? String(item.id);
      return !hiddenAslSegmentIds.has(segmentKey);
    });
  }, [hiddenAslSegmentIds, transcriptItems, transcriptMode]);

  const latestTranscript = useMemo(() => {
    if (!transcribing) return "AI transcript is paused.";
    if (visibleTranscriptItems.length === 0) {
      return transcriptMode === "asl"
        ? "Waiting for ASL signs..."
        : "Listening for transcript...";
    }

    const last = visibleTranscriptItems[visibleTranscriptItems.length - 1];
    const spaces = transcriptMode === "asl" ? " ".repeat(manualAslSpaces) : "";
    return `${last.speaker}: ${last.content}${spaces}`;
  }, [manualAslSpaces, transcribing, transcriptMode, visibleTranscriptItems]);

  async function openAslMode() {
    const willEnableAsl = transcriptMode !== "asl";

    setTranscriptMode(willEnableAsl ? "asl" : "speech");
    setExpanded(true);

    if (!willEnableAsl || cameraEnabled) return;

    try {
      await room?.localParticipant?.setCameraEnabled?.(true);

      setTimeout(() => {
        syncLocalMediaState();
      }, 250);

      setTimeout(() => {
        syncLocalMediaState();
      }, 700);
    } catch (error) {
      console.warn("[ASL] Failed to enable camera for ASL detection", error);
    }
  }

  function clearAslTranscript() {
    setHiddenAslSegmentIds(
      new Set(
        transcriptItems
          .filter((item) => item.source === "asl" || item.content.startsWith("[ASL]"))
          .map((item) => item.segmentId ?? String(item.id))
      )
    );
    setManualAslSpaces(0);
  }

  function addAslSpace() {
    setManualAslSpaces((prev) => Math.min(prev + 1, 12));
  }

  function toggleAslMode() {
    setAslMode((prev) => (prev === "static" ? "motion" : "static"));
  }

  async function toggleMute() {
    const nextMuted = !muted;
    try {
      await room?.localParticipant?.setMicrophoneEnabled?.(!nextMuted);
      setMuted(nextMuted);
    } catch (error) {
      console.warn("Failed to toggle microphone", error);
    }
  }

  async function toggleCamera() {
    const nextEnabled = !cameraEnabled;

    try {
      await room?.localParticipant?.setCameraEnabled?.(nextEnabled);

      setTimeout(() => {
        syncLocalMediaState();
      }, 250);

      setTimeout(() => {
        syncLocalMediaState();
      }, 700);
    } catch (error) {
      console.warn("Failed to toggle camera", error);
    }
  }

  async function switchCamera() {
    try {
      const nextFacing = cameraFacing === "front" ? "back" : "front";

      const publication = room?.localParticipant?.getTrackPublication?.(
        Track.Source.Camera
      );
      const track = publication?.videoTrack ?? publication?.track;

      await track?.restartTrack?.({
        facingMode: nextFacing === "front" ? "user" : "environment",
      });

      setCameraFacing(nextFacing);

      setTimeout(() => {
        syncLocalMediaState();
      }, 250);
    } catch (error) {
      console.warn("Failed to switch camera", error);
    }
  }

  return (
    <View style={styles.liveStage}>
      <View style={styles.remoteStage}>
        {hasRemoteVideo ? (
          <VideoTrackComponent
            trackRef={remoteTrackRef as any}
            style={styles.remoteVideo}
          />
        ) : (
          <VideoPlaceholder
            title={contact.name}
            subtitle={
              !hasRemoteParticipant
                ? "Waiting for remote participant"
                : "Remote camera off"
            }
            initials={contact.initials}
            avatarColor={contact.avatarColor}
          />
        )}
      </View>

      <View style={styles.topRightOverlay}>
        <View ref={localPreviewRef} collapsable={false} style={styles.localPreviewShell}>
          {hasLocalVideo ? (
            <VideoTrackComponent
              trackRef={localPreviewTrackRef as any}
              style={styles.localVideo}
            />
          ) : (
            <VideoPlaceholder
              title="You"
              subtitle="Your camera is off"
              initials="ME"
              avatarColor="#4C6EF5"
              compact
            />
          )}
        </View>
      </View>

      <View style={styles.statusPill}>
        <Text style={styles.statusPillText}>
          {formattedDuration} · {formatStatus(session)}
        </Text>
      </View>

      {expanded ? (
        <View style={styles.transcriptExpandedWrap}>
          <TranscriptPanel
            items={visibleTranscriptItems as any}
            transcribing={transcribing}
            expanded={expanded}
            onToggleExpanded={() => setExpanded(false)}
            containerStyle={styles.transcriptExpandedPanel}
            title={transcriptMode === "asl" ? "ASL Transcript" : "AI Live Transcript"}
            mode={transcriptMode}
            onModeChange={setTranscriptMode}
            showModeTabs
            aslMode={aslMode}
            onToggleAslMode={toggleAslMode}
            onClearAsl={clearAslTranscript}
            onSpaceAsl={addAslSpace}
            aslLiveLetter={lastSegment?.letter}
            aslConfidence={lastSegment?.confidence}
          />
        </View>
      ) : (
        <Pressable style={styles.transcriptDock} onPress={() => setExpanded(true)}>
          <View style={styles.transcriptDockHeader}>
            <View style={styles.transcriptDockTitleRow}>
              <MaterialIcons
                name={transcriptMode === "asl" ? "pan-tool" : "smart-toy"}
                size={16}
                color={colors.surface}
              />
              <Text style={styles.transcriptDockTitle}>
                {transcriptMode === "asl" ? "ASL Transcript" : "AI Transcript"}
              </Text>
            </View>
            <Feather name="chevron-up" size={16} color="#DCE3FF" />
          </View>
          <Text style={styles.transcriptDockText} numberOfLines={1}>
            {latestTranscript}
          </Text>
        </Pressable>
      )}

      <View style={styles.controlsRow}>
        <ControlButton
          label="Mute"
          icon={
            <Feather
              name={muted ? "mic-off" : "mic"}
              size={22}
              color={colors.surface}
            />
          }
          onPress={toggleMute}
        />
        <ControlButton
          label="Camera"
          icon={
            <Feather
              name={cameraEnabled ? "video" : "video-off"}
              size={22}
              color={colors.surface}
            />
          }
          onPress={toggleCamera}
        />
        <ControlButton
          label="End"
          danger
          icon={<Feather name="phone" size={24} color={colors.surface} />}
          onPress={onEnd}
        />
        <ControlButton
          label="Flip"
          icon={
            <Ionicons
              name="camera-reverse-outline"
              size={22}
              color={colors.surface}
            />
          }
          onPress={switchCamera}
        />
        <ControlButton
          label="ASL"
          active={transcriptMode === "asl"}
          icon={<MaterialIcons name="pan-tool" size={22} color={colors.surface} />}
          onPress={openAslMode}
        />
      </View>
    </View>
  );
}

function ControlButton({
  label,
  icon,
  danger,
  active,
  onPress,
}: {
  label: string;
  icon: ReactNode;
  danger?: boolean;
  active?: boolean;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      style={[
        styles.controlBtn,
        active && styles.controlBtnActive,
        danger && styles.controlBtnDanger,
      ]}
      onPress={onPress}
    >
      {icon}
      <Text style={styles.controlLabel}>{label}</Text>
    </Pressable>
  );
}

function VideoPlaceholder({
  title,
  subtitle,
  initials,
  avatarColor,
  compact = false,
}: {
  title: string;
  subtitle: string;
  initials: string;
  avatarColor: string;
  compact?: boolean;
}) {
  return (
    <View style={[styles.placeholder, compact && styles.placeholderCompact]}>
      <View style={[styles.placeholderAvatar, { backgroundColor: avatarColor }]}>
        <Text style={styles.placeholderAvatarText}>{initials}</Text>
      </View>
      {!compact ? (
        <>
          <Text style={styles.placeholderTitle}>{title}</Text>
          <Text style={styles.placeholderSubtitle}>{subtitle}</Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  liveStage: {
    flex: 1,
    backgroundColor: "#07101F",
  },
  remoteStage: {
    flex: 1,
    backgroundColor: "#000814",
  },
  remoteVideo: {
    flex: 1,
  },
  localPreviewShell: {
    width: 136,
    height: 192,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  localVideo: {
    flex: 1,
  },
  topRightOverlay: {
    position: "absolute",
    top: 24,
    right: 16,
  },
  statusPill: {
    position: "absolute",
    top: 26,
    left: 16,
    backgroundColor: "rgba(8, 22, 42, 0.78)",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  statusPillText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "700",
  },
  transcriptDock: {
    position: "absolute",
    right: 16,
    bottom: 132,
    width: 220,
    borderRadius: 20,
    backgroundColor: "rgba(8, 22, 42, 0.88)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  transcriptDockHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  transcriptDockTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  transcriptDockTitle: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "700",
  },
  transcriptDockText: {
    color: "#DCE3FF",
    fontSize: 12,
    lineHeight: 18,
  },
  transcriptExpandedWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 132,
  },
  transcriptExpandedPanel: {
    maxHeight: 260,
    backgroundColor: "rgba(8, 22, 42, 0.94)",
  },
  controlsRow: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 28,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
  },
  controlBtn: {
    minWidth: 72,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: "rgba(12, 31, 59, 0.9)",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  controlBtnActive: {
    backgroundColor: "rgba(56,189,248,0.92)",
  },
  controlBtnDanger: {
    backgroundColor: "#E5484D",
  },
  controlLabel: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: "700",
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0B1730",
    gap: 10,
  },
  placeholderCompact: {
    gap: 0,
  },
  placeholderAvatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderAvatarText: {
    color: colors.surface,
    fontSize: 28,
    fontWeight: "800",
  },
  placeholderTitle: {
    color: colors.surface,
    fontSize: 28,
    fontWeight: "800",
  },
  placeholderSubtitle: {
    color: "#C1D0F2",
    fontSize: 15,
  },
});