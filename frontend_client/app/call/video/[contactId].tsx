import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Feather, Ionicons, MaterialIcons } from "@expo/vector-icons";
import * as LiveKit from "@livekit/react-native";
import { Track } from "livekit-client";

import { callService } from "../../../src/services/callService";
import { useCallSession } from "../../../src/hooks/useCallSession";
import { useAiTranscript } from "../../../src/hooks/useAiTranscript";
import { rtcEngine } from "../../../src/services/rtc/rtcEngineInstance";
import type { CallContact, CallSession } from "../../../src/types/call";
import CallHeader from "../../../src/components/call/CallHeader";
import TranscriptPanel from "../../../src/components/call/TranscriptPanel";
import { colors } from "../../../src/theme/colors";

const LiveKitRoomComponent: any = (LiveKit as any).LiveKitRoom;
const VideoTrackComponent: any = (LiveKit as any).VideoTrack;
const useTracksHook = (((LiveKit as any).useTracks ?? (() => [])) as unknown) as (
  sources: any
) => any[];
const useRoomContextHook = (((LiveKit as any).useRoomContext ??
  (() => null)) as unknown) as () => any;
const isTrackReferenceValue = (((LiveKit as any).isTrackReference ??
  (() => false)) as unknown) as (value: any) => boolean;
const audioSession = (((LiveKit as any).AudioSession ?? {}) as unknown) as {
  startAudioSession?: () => Promise<void>;
  stopAudioSession?: () => Promise<void>;
};

type TrackReferenceLike = any;

function formatStatus(session: any) {
  if (!session) return "Connecting";
  if (session.callState === "ringing" || session.call_state === "ringing") {
    return "Ringing";
  }
  if (session.callState === "active" || session.call_state === "active") {
    return "Connected";
  }
  if (session.callState === "declined" || session.call_state === "declined") {
    return "Call declined";
  }
  if (session.callState === "canceled" || session.call_state === "canceled") {
    return "Call canceled";
  }
  if (session.callState === "timeout" || session.call_state === "timeout") {
    return "No answer";
  }
  if (session.callState === "ended" || session.call_state === "ended") {
    return "Call ended";
  }
  return session.consultationStatus ?? session.consultation_status ?? "Connecting";
}

export default function VideoCallScreen() {
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
  const [expanded, setExpanded] = useState(false);
  const [roomReady, setRoomReady] = useState(false);

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
    session: hookSession,
    loading,
    error: sessionError,
    formattedDuration,
    transcribing,
    stopTranscribing,
    endCurrentCall,
  } = useCallSession(contact, "video", {
    callId: Number.isFinite(routeCallId) ? routeCallId : undefined,
  });

  const { items: transcriptItems } = useAiTranscript(
    (hookSession as any)?.callId,
    Boolean((hookSession as any)?.transcribing)
  );

  useEffect(() => {
    Promise.resolve(audioSession.startAudioSession?.()).catch((error) => {
      console.warn("Failed to start LiveKit audio session", error);
    });

    return () => {
      Promise.resolve(audioSession.stopAudioSession?.()).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!hookSession || !contact) return;
    const mode = (hookSession as any)?.mode;
    const callId = (hookSession as any)?.callId;

    if (mode !== "audio") return;

    router.replace({
      pathname: "/call/audio/[contactId]",
      params: { contactId: contact.id, callId: String(callId) },
    });
  }, [(hookSession as any)?.mode, (hookSession as any)?.callId, contact?.id]);

  useEffect(() => {
    let active = true;

    async function prepareRoom() {
      const sessionAny: any = hookSession;
      if (!sessionAny || sessionAny.callState !== "active") {
        setRoomReady(true);
        return;
      }

      setRoomReady(false);

      try {
        await rtcEngine.leaveCall({ preserveIdleState: true });
      } catch {}

      if (active) {
        setRoomReady(true);
      }
    }

    prepareRoom();

    return () => {
      active = false;
    };
  }, [(hookSession as any)?.callId, (hookSession as any)?.mode, (hookSession as any)?.callState]);

  useEffect(() => {
    const ended = (hookSession as any)?.ended;
    if (!hookSession || !ended) return;

    const timer = setTimeout(() => {
      router.replace("/call");
    }, 900);

    return () => clearTimeout(timer);
  }, [(hookSession as any)?.ended, (hookSession as any)?.callState]);

  const error = contactError || sessionError;

  if (contactLoading || loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.surface} />
      </SafeAreaView>
    );
  }

  if (!contact || !hookSession) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <Text style={styles.errorText}>
          {error || "Unable to start video call."}
        </Text>
        <Pressable
          style={styles.backToListBtn}
          onPress={() => router.replace("/call")}
        >
          <Text style={styles.backToListText}>Back to call center</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const session: any = (hookSession as any) ?? null;
  const joinPayload: any = session?.joinPayload ?? session?.join_payload ?? null;

  const callId =
    session?.callId ??
    session?.call_id ??
    joinPayload?.callId ??
    joinPayload?.call_id ??
    undefined;

  const roomId =
    session?.roomId ??
    session?.room_id ??
    joinPayload?.roomId ??
    joinPayload?.room_id ??
    undefined;

  const callState =
    session?.callState ??
    session?.call_state ??
    session?.state ??
    joinPayload?.state ??
    undefined;

  const serverUrl =
    joinPayload?.livekitUrl ??
    joinPayload?.livekit_url ??
    session?.livekitUrl ??
    session?.livekit_url ??
    undefined;

  const token =
    joinPayload?.accessToken ??
    joinPayload?.access_token ??
    session?.accessToken ??
    session?.access_token ??
    undefined;

  console.log("VIDEO SESSION", {
    callId,
    roomId,
    callState,
    livekitUrl: serverUrl,
    hasToken: !!token,
    tokenPrefix: token?.slice?.(0, 24),
  });

  const canJoinLiveKit = Boolean(
    callState === "active" && serverUrl && token && roomReady
  );

  const pendingSubtitle = !roomReady
    ? "Preparing video room"
    : !serverUrl || !token
      ? "LiveKit credentials are missing"
      : formatStatus(session);

  return (
    <SafeAreaView style={styles.container}>
      <CallHeader
        time={formattedDuration}
        aiEnabled={transcribing}
        dark
        onBack={() => router.back()}
      />

      <View style={styles.stage}>
        {canJoinLiveKit ? (
          <LiveKitRoomComponent
            key={`${callId}-${session?.mode ?? "video"}`}
            serverUrl={serverUrl}
            token={token}
            connect={canJoinLiveKit}
            audio
            video
            options={{ adaptiveStream: { pixelDensity: "screen" } }}
            onError={(livekitError: any) => {
              console.error("LIVEKIT ROOM ERROR", {
                name: livekitError?.name,
                message: livekitError?.message,
                full: livekitError,
                callId,
                roomId,
                livekitUrl: serverUrl,
                tokenPrefix: token?.slice?.(0, 24),
              });
            }}
          >
            <ConnectedVideoStage
              contact={contact}
              session={session}
              formattedDuration={formattedDuration}
              transcribing={transcribing}
              transcriptItems={transcriptItems}
              expanded={expanded}
              setExpanded={setExpanded}
              onStopTranscribing={stopTranscribing}
              onEnd={async (room) => {
                try {
                  await room?.disconnect?.();
                } catch {}
                await endCurrentCall();
                router.replace("/call");
              }}
            />
          </LiveKitRoomComponent>
        ) : (
          <View style={styles.pendingStage}>
            <View style={styles.pendingAvatar}>
              <Text style={styles.pendingAvatarText}>{contact.initials}</Text>
            </View>
            <Text style={styles.pendingTitle}>{contact.name}</Text>
            <Text style={styles.pendingSubtitle}>{pendingSubtitle}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

type ConnectedVideoStageProps = {
  contact: CallContact;
  session: any;
  formattedDuration: string;
  transcribing: boolean;
  transcriptItems: Array<{ id: number; speaker: string; content: string }>;
  expanded: boolean;
  setExpanded: (value: boolean) => void;
  onStopTranscribing: () => Promise<void>;
  onEnd: (room: any) => Promise<void>;
};

function ConnectedVideoStage({
  contact,
  session,
  formattedDuration,
  transcribing,
  transcriptItems,
  expanded,
  setExpanded,
  onStopTranscribing,
  onEnd,
}: ConnectedVideoStageProps) {
  const room = useRoomContextHook();
  const tracks = useTracksHook([
    { source: Track.Source.Camera, withPlaceholder: false },
  ]) as TrackReferenceLike[];

  const [cameraFacing, setCameraFacing] = useState<"front" | "back">("front");
  const [muted, setMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);

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

  const localCameraPublication = useMemo(() => {
    return room?.localParticipant?.getTrackPublication?.(Track.Source.Camera) ?? null;
  }, [room, tracks]);

  const localPreviewTrackRef = useMemo(() => {
    const camPub =
      room?.localParticipant?.getTrackPublication?.(Track.Source.Camera) ?? null;

    if (localTrackFromHook) {
      return localTrackFromHook;
    }

    const hasUsableVideoTrack = Boolean(
      camPub &&
        !camPub.isMuted &&
        (camPub.videoTrack || camPub.track)
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
      camPub &&
        !camPub.isMuted &&
        (camPub.videoTrack || camPub.track)
    );

    const micIsMuted = Boolean(micPub?.isMuted);

    setCameraEnabled(cameraIsOn);
    setMuted(micIsMuted);
  };

  useEffect(() => {
    let cancelled = false;

    async function ensureInitialLocalPreview() {
      if (!room?.localParticipant) return;
      if ((session?.mode ?? "video") !== "video") return;

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
  }, [room, session?.callId, session?.mode]);

  const hasRemoteParticipant = remoteParticipants.length > 0;
  const hasRemoteVideo = !!remoteTrackRef;
  const hasLocalVideo = !!localPreviewTrackRef && cameraEnabled;

  const latestTranscript = useMemo(() => {
    if (!transcribing) return "AI transcript is paused.";
    if (transcriptItems.length === 0) return "Listening for transcript...";
    const last = transcriptItems[transcriptItems.length - 1];
    return `${last.speaker}: ${last.content}`;
  }, [transcribing, transcriptItems]);

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
        <View style={styles.localPreviewShell}>
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
            items={transcriptItems as any}
            transcribing={transcribing}
            expanded={expanded}
            onToggleExpanded={() => setExpanded(false)}
            containerStyle={styles.transcriptExpandedPanel}
          />
        </View>
      ) : (
        <Pressable style={styles.transcriptDock} onPress={() => setExpanded(true)}>
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
          onPress={() => onEnd(room)}
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
          label={transcribing ? "Stop AI" : "AI Off"}
          icon={<MaterialIcons name="smart-toy" size={22} color={colors.surface} />}
          onPress={onStopTranscribing}
        />
      </View>
    </View>
  );
}

function ControlButton({
  label,
  icon,
  danger,
  onPress,
}: {
  label: string;
  icon: ReactNode;
  danger?: boolean;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      style={[styles.controlBtn, danger && styles.controlBtnDanger]}
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
  container: {
    flex: 1,
    backgroundColor: "#07101F",
  },
  stage: {
    flex: 1,
  },
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
  pendingStage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#07101F",
    gap: 12,
  },
  pendingAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#304E8F",
    alignItems: "center",
    justifyContent: "center",
  },
  pendingAvatarText: {
    color: colors.surface,
    fontSize: 30,
    fontWeight: "800",
  },
  pendingTitle: {
    color: colors.surface,
    fontSize: 26,
    fontWeight: "800",
  },
  pendingSubtitle: {
    color: "#C1D0F2",
    fontSize: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#07101F",
    paddingHorizontal: 24,
  },
  errorText: {
    color: colors.surface,
    fontSize: 16,
    textAlign: "center",
    marginBottom: 20,
  },
  backToListBtn: {
    backgroundColor: "#8294E8",
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  backToListText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: "700",
  },
});