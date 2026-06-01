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
import { Feather } from "@expo/vector-icons";
import * as LiveKit from "@livekit/react-native";

import { callService } from "../../../src/services/callService";
import { activeCallService } from "../../../src/services/activeCallService";
import { useCallSession } from "../../../src/hooks/useCallSession";
import { useAiTranscript } from "../../../src/hooks/useAiTranscript";
import { rtcEngine } from "../../../src/services/rtc/rtcEngineInstance";
import { callSignalingService } from "../../../src/services/call/callSignalingService";
import type {
  CallContact,
  CallJoinPayload,
  CallSession,
} from "../../../src/types/call";
import CallHeader from "../../../src/components/call/CallHeader";
import CallVideoStage from "../../../src/components/call/CallVideoStage";
import CallSummaryModal from "../../../src/components/call/CallSummaryModal";
import { callSummaryState } from "../../../src/services/callSummaryState";
import { colors } from "../../../src/theme/colors";

const LiveKitRoomComponent: any = (LiveKit as any).LiveKitRoom;
const audioSession = ((LiveKit as any).AudioSession ?? {}) as {
  startAudioSession?: () => Promise<void>;
  stopAudioSession?: () => Promise<void>;
};

function buildRouteFallbackContact(
  contactId: string | undefined,
  callId: number,
  params: {
    contactName?: string;
    contactUserId?: string;
    contactRole?: string;
  }
): CallContact | null {
  const active = Number.isFinite(callId)
    ? activeCallService.getByCallId(callId)
    : null;

  if (active?.doctor) {
    return {
      id: contactId || String(active.remoteUserId ?? active.callId),
      userId: active.remoteUserId ?? active.doctor.userId,
      name: active.doctor.name || params.contactName || "Incoming call",
      initials: active.doctor.initials ||
        String(active.doctor.name || params.contactName || "IC")
          .split(" ")
          .map((part) => part[0])
          .join("")
          .slice(0, 2)
          .toUpperCase(),
      role: active.doctor.role || params.contactRole || "Care team",
      specialty: active.doctor.role || params.contactRole || "Care team",
      lastSeen: "",
      online: true,
      avatarColor: "#4C6EF5",
      conversationId: active.conversationId,
    };
  }

  const name = params.contactName || "Incoming call";
  const userId = Number(params.contactUserId || contactId);

  if (!contactId && !Number.isFinite(userId)) return null;

  return {
    id: contactId || String(userId),
    userId: Number.isFinite(userId) ? userId : undefined,
    name,
    initials: String(name)
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    role: params.contactRole || "Care team",
    specialty: params.contactRole || "Care team",
    lastSeen: "",
    online: true,
    avatarColor: "#4C6EF5",
    conversationId: undefined,
  };
}

function formatStatus(session: CallSession) {
  if (session.callState === "ringing") return "Ringing…";
  if (session.callState === "active") return "Connected";
  if (session.callState === "declined") return "Call declined";
  if (session.callState === "canceled") return "Call canceled";
  if (session.callState === "timeout") return "No answer";
  if (session.callState === "ended") return "Call ended";
  return session.consultationStatus || "Connecting";
}

export default function VideoCallScreen() {
  const params = useLocalSearchParams<{
    contactId: string;
    callId?: string;
    contactName?: string;
    contactUserId?: string;
    contactRole?: string;
  }>();

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
        setContact(
          data ??
            buildRouteFallbackContact(contactId, routeCallId, {
              contactName: Array.isArray(params.contactName)
                ? params.contactName[0]
                : params.contactName,
              contactUserId: Array.isArray(params.contactUserId)
                ? params.contactUserId[0]
                : params.contactUserId,
              contactRole: Array.isArray(params.contactRole)
                ? params.contactRole[0]
                : params.contactRole,
            })
        );
      } catch (err) {
        setContactError(
          err instanceof Error ? err.message : "Unable to load contact"
        );
      } finally {
        setContactLoading(false);
      }
    }

    loadContact();
  }, [contactId, routeCallId, params.contactName, params.contactUserId, params.contactRole]);

  const {
    session,
    loading,
    error: sessionError,
    formattedDuration,
    transcribing,
    endCurrentCall,
  } = useCallSession(contact, "video", {
    callId: Number.isFinite(routeCallId) ? routeCallId : undefined,
  });

  const { items: transcriptItems } = useAiTranscript(
    session?.callId,
    Boolean(session?.callState === "active" || session?.transcribing)
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
    if (!session || !contact || session.callState !== "active") return;

    const callId = String(session.callId);
    const localUserId = String(session.patient.userId ?? session.patient.name);
    const remoteUserId = String(contact.userId ?? contact.id);

    callSignalingService
      .joinCall({ callId, mode: "video", localUserId, remoteUserId })
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
    if (!session || !contact) return;
    if (session.mode !== "audio") return;
    router.replace({
      pathname: "/call/audio/[contactId]",
      params: { contactId: contact.id, callId: String(session.callId) },
    });
  }, [session?.mode, session?.callId, contact?.id]);

  useEffect(() => {
    let active = true;

    async function prepareRoom() {
      if (!session || session.callState !== "active") {
        setRoomReady(true);
        return;
      }
      setRoomReady(false);
      try {
        await rtcEngine.leaveCall({ preserveIdleState: true });
      } catch {}
      if (active) setRoomReady(true);
    }

    prepareRoom();
    return () => { active = false; };
  }, [session?.callId, session?.mode, session?.callState]);

  // When call ends by remote hang-up / timeout, show summary
  useEffect(() => {
    if (!session?.ended) return;
    setFinalTranscriptItems((prev) => prev.length > 0 ? prev : transcriptItems);
    setFinalDuration((prev) => prev !== "00:00" ? prev : formattedDuration);
    callSummaryState.setSummaryVisible(true);
    setShowSummary(true);
  }, [session?.ended]);

  const error = contactError || sessionError;

  if (contactLoading || loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.surface} />
      </SafeAreaView>
    );
  }

  if (!contact || !session) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <Text style={styles.errorText}>
          {error || "Unable to start video call."}
        </Text>
        <Pressable
          style={styles.backToListBtn}
          onPress={() => router.replace("/call")}
        >
          <Text style={styles.backToListText}>Back to call centre</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const joinPayload: CallJoinPayload | null = session.joinPayload ?? null;
  const callId = session.callId;
  const serverUrl = joinPayload?.livekitUrl ?? session.livekitUrl ?? undefined;
  const token = joinPayload?.accessToken ?? undefined;
  const callState = session.callState ?? joinPayload?.state ?? undefined;

  const canJoinLiveKit = Boolean(
    session.callState === "active" && roomReady && serverUrl && token
  );

  const pendingSubtitle = !roomReady
    ? "Preparing video room"
    : !serverUrl || !token
    ? "Credentials missing"
    : formatStatus(session);

  return (
    <View style={styles.root}>
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
            key={`${callId}-${session.mode ?? "video"}`}
            serverUrl={serverUrl}
            token={token}
            connect={canJoinLiveKit}
            audio
            video
            options={{ adaptiveStream: { pixelDensity: "screen" } }}
            onError={(livekitError: any) => {
              console.error("LIVEKIT ROOM ERROR", livekitError);
            }}
          >
            <CallVideoStage
              contact={contact}
              session={session}
              formattedDuration={formattedDuration}
              transcribing={transcribing}
              transcriptItems={transcriptItems}
              expanded={expanded}
              setExpanded={setExpanded}
              onEnd={async () => {
                setFinalTranscriptItems([...transcriptItems]);
                setFinalDuration(formattedDuration);
                callSummaryState.setSummaryVisible(true);
                setShowSummary(true);
                await endCurrentCall();
              }}
            />
          </LiveKitRoomComponent>
        ) : (
          // Pre-connection / ringing state
          <View style={styles.pendingStage}>
            <View style={[styles.pendingAvatar, { backgroundColor: contact.avatarColor }]}>
              <Text style={styles.pendingAvatarText}>{contact.initials}</Text>
            </View>
            <Text style={styles.pendingTitle}>{contact.name}</Text>
            <Text style={styles.pendingRole}>{contact.role ?? contact.specialty}</Text>
            <Text style={styles.pendingSubtitle}>{pendingSubtitle}</Text>

            <View style={styles.pendingEndArea}>
              <Pressable
                style={styles.pendingEndButton}
                onPress={async () => {
                  await endCurrentCall();
                  router.replace("/call");
                }}
              >
                <Feather name="phone-off" size={26} color={colors.surface} />
              </Pressable>
              <Text style={styles.pendingEndText}>End call</Text>
            </View>
          </View>
        )}
      </View>

      </SafeAreaView>

      {/* Summary modal — full screen overlay outside SafeAreaView */}
      {showSummary && (
        <CallSummaryModal
          visible={showSummary}
          onClose={() => {
            callSummaryState.setSummaryVisible(false);
            setShowSummary(false);
            router.replace("/call");
          }}
          session={session}
          contact={contact}
          transcriptItems={finalTranscriptItems.length > 0 ? finalTranscriptItems : transcriptItems}
          formattedDuration={finalDuration || formattedDuration}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#07101F",
  },
  container: {
    flex: 1,
    backgroundColor: "#07101F",
  },
  stage: {
    flex: 1,
  },
  pendingStage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#07101F",
    gap: 10,
  },
  pendingAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  pendingAvatarText: {
    color: colors.surface,
    fontSize: 32,
    fontWeight: "800",
  },
  pendingTitle: {
    color: colors.surface,
    fontSize: 26,
    fontWeight: "800",
  },
  pendingRole: {
    color: "rgba(193,208,242,0.7)",
    fontSize: 14,
    fontWeight: "600",
  },
  pendingSubtitle: {
    color: "rgba(193,208,242,0.55)",
    fontSize: 15,
    marginBottom: 24,
  },
  pendingEndArea: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 40,
    alignItems: "center",
    gap: 8,
  },
  pendingEndButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#D9534F",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#D9534F",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  pendingEndText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "700",
    opacity: 0.7,
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
    opacity: 0.8,
  },
  backToListBtn: {
    backgroundColor: colors.primary,
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