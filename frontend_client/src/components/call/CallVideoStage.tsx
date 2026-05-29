import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from "react-native";
import { Feather, Ionicons, MaterialIcons } from "@expo/vector-icons";
import * as LiveKit from "@livekit/react-native";
import { Track } from "livekit-client";

import TranscriptPanel from "./TranscriptPanel";
import AslLiveKitFrameCapture from "./AslLiveKitFrameCapture";
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
  if (session.callState === "ringing") return "Ringing…";
  if (session.callState === "active") return "Connected";
  if (session.callState === "declined") return "Declined";
  if (session.callState === "canceled") return "Canceled";
  if (session.callState === "timeout") return "No answer";
  if (session.callState === "ended") return "Ended";
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
  const localVideoCaptureRef = useRef<View>(null);

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
    if (localTrackFromHook) return localTrackFromHook;
    const hasUsableVideoTrack = Boolean(
      camPub && !camPub.isMuted && (camPub.videoTrack || camPub.track)
    );
    if (!room?.localParticipant || !camPub || !hasUsableVideoTrack) return null;
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
    setCameraEnabled(Boolean(camPub && !camPub.isMuted && (camPub.videoTrack || camPub.track)));
    setMuted(Boolean(micPub?.isMuted));
  };

  useEffect(() => {
    let cancelled = false;

    async function ensureInitialLocalPreview() {
      if (!room?.localParticipant) return;
      if (session.mode !== "video") return;
      try {
        await room.localParticipant.setCameraEnabled?.(true);
      } catch {}
      const t1 = setTimeout(() => { if (!cancelled) syncLocalMediaState(); }, 250);
      const t2 = setTimeout(() => { if (!cancelled) syncLocalMediaState(); }, 800);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }

    const cleanupPromise = ensureInitialLocalPreview();
    const interval = setInterval(() => syncLocalMediaState(), 1000);

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

  const handleAslFrame = useCallback(
    (imageB64: string) => {
      sendFrame(imageB64, aslMode);
    },
    [aslMode, sendFrame]
  );

  const handleAslCameraError = useCallback((message: string, error?: unknown) => {
    console.warn(`[ASL] ${message}`, error);
  }, []);

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
    if (!transcribing) return "Transcript paused";
    if (visibleTranscriptItems.length === 0) {
      return transcriptMode === "asl" ? "Waiting for ASL…" : "Listening…";
    }
    const last = visibleTranscriptItems[visibleTranscriptItems.length - 1];
    return `${last.speaker}: ${last.content}`;
  }, [transcribing, transcriptMode, visibleTranscriptItems]);

  async function openAslMode() {
    const willEnableAsl = transcriptMode !== "asl";
    setTranscriptMode(willEnableAsl ? "asl" : "speech");
    setExpanded(true);
    if (!willEnableAsl || cameraEnabled) return;
    try {
      await room?.localParticipant?.setCameraEnabled?.(true);
      setTimeout(() => syncLocalMediaState(), 250);
      setTimeout(() => syncLocalMediaState(), 700);
    } catch (error) {
      console.warn("[ASL] Failed to enable camera", error);
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
    } catch {}
  }

  async function toggleCamera() {
    try {
      await room?.localParticipant?.setCameraEnabled?.(!cameraEnabled);
      setTimeout(() => syncLocalMediaState(), 250);
      setTimeout(() => syncLocalMediaState(), 700);
    } catch {}
  }

  async function switchCamera() {
    try {
      const nextFacing = cameraFacing === "front" ? "back" : "front";
      const publication = room?.localParticipant?.getTrackPublication?.(Track.Source.Camera);
      const track = publication?.videoTrack ?? publication?.track;
      await track?.restartTrack?.({ facingMode: nextFacing === "front" ? "user" : "environment" });
      setCameraFacing(nextFacing);
      setTimeout(() => syncLocalMediaState(), 250);
    } catch {}
  }

  async function handleEnd() {
    await onEnd();
  }

  return (
    <View style={styles.liveStage}>
      {/* Remote video / placeholder */}
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
              !hasRemoteParticipant ? "Waiting for other participant" : "Camera off"
            }
            initials={contact.initials}
            avatarColor={contact.avatarColor}
          />
        )}
      </View>

      {/* Local preview. ASL mode now snapshots this existing LiveKit local video view. */}
      <View style={styles.topRightOverlay}>
        <View
          ref={localVideoCaptureRef}
          collapsable={false}
          style={styles.localPreviewShell}
        >
          {hasLocalVideo ? (
            <VideoTrackComponent
              trackRef={localPreviewTrackRef as any}
              style={styles.localVideo}
            />
          ) : (
            <VideoPlaceholder
              title="You"
              subtitle="Camera off"
              initials="ME"
              avatarColor="#4C6EF5"
              compact
            />
          )}
        </View>

        <AslLiveKitFrameCapture
          active={aslCaptureActive && hasLocalVideo}
          targetRef={localVideoCaptureRef}
          onFrame={handleAslFrame}
          onError={handleAslCameraError}
        />

        {/* ASL live indicator on local preview */}
        {aslCaptureActive && lastSegment?.letter && (
          <View style={styles.aslLocalBadge}>
            <Text style={styles.aslLocalLetter}>{lastSegment.letter}</Text>
          </View>
        )}
      </View>

      {/* Status pill (top-left) */}
      <View style={styles.statusPill}>
        <View style={[styles.statusDot, session.callState === "active" && styles.statusDotActive]} />
        <Text style={styles.statusPillText}>
          {formattedDuration} · {formatStatus(session)}
        </Text>
      </View>

      {/* ASL remote overlay — shown to BOTH sides when ASL is active */}
      {aslCaptureActive && (
        <View style={styles.aslRemoteOverlay}>
          <MaterialIcons name="sign-language" size={13} color="rgba(255,255,255,0.7)" />
          <Text style={styles.aslRemoteText}>
            {lastSegment?.letter
              ? `ASL: ${lastSegment.letter} (${Math.round((lastSegment.confidence ?? 0) * 100)}%)`
              : "ASL detection active"}
          </Text>
        </View>
      )}

      {/* Transcript panel — collapsed dock or expanded */}
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
        <Pressable
          style={styles.transcriptDock}
          onPress={() => setExpanded(true)}
        >
          <View style={styles.transcriptDockRow}>
            <MaterialIcons
              name={transcriptMode === "asl" ? "sign-language" : "smart-toy"}
              size={14}
              color="rgba(255,255,255,0.7)"
            />
            <Text style={styles.transcriptDockText} numberOfLines={1}>
              {latestTranscript}
            </Text>
            <Feather name="chevron-up" size={14} color="rgba(255,255,255,0.6)" />
          </View>
        </Pressable>
      )}

      {/* Control bar */}
      <View style={styles.controlsRow}>
        <ControlButton
          label={muted ? "Unmute" : "Mute"}
          icon={
            <Feather
              name={muted ? "mic-off" : "mic"}
              size={21}
              color={colors.surface}
            />
          }
          active={muted}
          onPress={toggleMute}
        />
        <ControlButton
          label={cameraEnabled ? "Camera" : "Cam Off"}
          icon={
            <Feather
              name={cameraEnabled ? "video" : "video-off"}
              size={21}
              color={colors.surface}
            />
          }
          active={!cameraEnabled}
          onPress={toggleCamera}
        />
        <ControlButton
          label="End"
          danger
          icon={<Feather name="phone-off" size={22} color={colors.surface} />}
          onPress={handleEnd}
          large
        />
        <ControlButton
          label="Flip"
          icon={
            <Ionicons
              name="camera-reverse-outline"
              size={21}
              color={colors.surface}
            />
          }
          onPress={switchCamera}
        />
        <ControlButton
          label="ASL"
          active={transcriptMode === "asl"}
          icon={
            <MaterialIcons
              name="sign-language"
              size={21}
              color={colors.surface}
            />
          }
          onPress={openAslMode}
        />
      </View>

    </View>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ControlButton({
  label,
  icon,
  danger,
  active,
  large,
  onPress,
}: {
  label: string;
  icon: ReactNode;
  danger?: boolean;
  active?: boolean;
  large?: boolean;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      style={[
        styles.controlBtn,
        active && styles.controlBtnActive,
        danger && styles.controlBtnDanger,
        large && styles.controlBtnLarge,
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
      <View
        style={[
          styles.placeholderAvatar,
          compact && styles.placeholderAvatarCompact,
          { backgroundColor: avatarColor },
        ]}
      >
        <Text
          style={[
            styles.placeholderAvatarText,
            compact && styles.placeholderAvatarTextCompact,
          ]}
        >
          {initials}
        </Text>
      </View>
      {!compact && (
        <>
          <Text style={styles.placeholderTitle}>{title}</Text>
          <Text style={styles.placeholderSubtitle}>{subtitle}</Text>
        </>
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

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
  // Local preview
  localPreviewShell: {
    width: 120,
    height: 168,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.15)",
  },
  localVideo: {
    flex: 1,
  },
  topRightOverlay: {
    position: "absolute",
    top: 20,
    right: 14,
    alignItems: "flex-end",
  },
  // ASL live badge on local preview
  aslLocalBadge: {
    marginTop: 6,
    backgroundColor: "rgba(124,145,219,0.92)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-end",
  },
  aslLocalLetter: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.surface,
  },
  // Status pill
  statusPill: {
    position: "absolute",
    top: 24,
    left: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(8, 22, 42, 0.72)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  statusDotActive: {
    backgroundColor: "#1DBB75",
  },
  statusPillText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    fontWeight: "700",
  },
  // ASL remote overlay (visible to both sides)
  aslRemoteOverlay: {
    position: "absolute",
    top: 64,
    left: 14,
    right: 14,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "rgba(124,145,219,0.22)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: 220,
  },
  aslRemoteText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontWeight: "600",
  },
  // Transcript dock (collapsed)
  transcriptDock: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 120,
    backgroundColor: "rgba(8, 22, 42, 0.86)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  transcriptDockRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  transcriptDockText: {
    flex: 1,
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    lineHeight: 18,
  },
  // Transcript expanded panel
  transcriptExpandedWrap: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 118,
    height: "50%",
  },
  transcriptExpandedPanel: {
    flex: 1,
    backgroundColor: "rgba(10, 24, 48, 0.97)",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 20,
  },
  // Control row
  controlsRow: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 24,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 14,
  },
  controlBtn: {
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: "rgba(14, 34, 64, 0.88)",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  controlBtnActive: {
    backgroundColor: "rgba(124,145,219,0.85)",
    borderColor: "rgba(124,145,219,0.5)",
  },
  controlBtnDanger: {
    backgroundColor: "#D9534F",
    borderColor: "#C0392B",
  },
  controlBtnLarge: {
    minWidth: 76,
    paddingVertical: 14,
    borderRadius: 26,
  },
  controlLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  // Video placeholders
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
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderAvatarCompact: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  placeholderAvatarText: {
    color: colors.surface,
    fontSize: 26,
    fontWeight: "800",
  },
  placeholderAvatarTextCompact: {
    fontSize: 14,
  },
  placeholderTitle: {
    color: colors.surface,
    fontSize: 24,
    fontWeight: "800",
  },
  placeholderSubtitle: {
    color: "rgba(193, 208, 242, 0.8)",
    fontSize: 14,
  },
});