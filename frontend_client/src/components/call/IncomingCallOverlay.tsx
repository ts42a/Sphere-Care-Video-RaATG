import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getAccessToken } from "../../services/sessionService";
import { wsClient } from "../../services/wsClient";
import { callService } from "../../services/callService";
import {
  incomingCallService,
  type IncomingCallState,
} from "../../services/call/incomingCallService";
import { miniCallService } from "../../services/miniCallService";
import type { CallContact } from "../../types/call";
import { colors } from "../../theme/colors";

function useIncomingCallState() {
  const [state, setState] = useState<IncomingCallState>(() => {
    try {
      return incomingCallService.getState();
    } catch {
      return {
        invite: null,
        contact: null,
        phase: "idle",
        receivedAtMs: undefined,
      };
    }
  });

  useEffect(() => {
    return incomingCallService.subscribe(setState);
  }, []);

  return state;
}

function buildFallbackContact(
  callerUserId: number | undefined,
  callerName: string,
  callerRole: string | null | undefined
): CallContact {
  return {
    id: String(callerUserId ?? callerName),
    userId: callerUserId,
    name: callerName,
    initials: String(callerName)
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    role: callerRole ?? "",
    specialty: "",
    lastSeen: "",
    online: true,
    avatarColor: "#4C6EF5",
    conversationId: undefined,
  };
}

function getCountdownLabel(expiresAt?: string | null) {
  if (!expiresAt) return "Secure call request";

  const expiresMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresMs)) return "Secure call request";

  const diffSeconds = Math.max(0, Math.ceil((expiresMs - Date.now()) / 1000));
  if (diffSeconds <= 0) return "Invite is about to expire";

  return `Answer within ${diffSeconds}s`;
}

export default function IncomingCallOverlay() {
  const insets = useSafeAreaInsets();
  const state = useIncomingCallState();
  const [busyAction, setBusyAction] = useState<"accept" | "decline" | "">("");
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let unsubscribeInvite = () => {};
    let unsubscribeCanceled = () => {};
    let unsubscribeTimeout = () => {};
    let unsubscribeEnded = () => {};
    let cancelled = false;

    async function setupIncomingCallWs() {
      try {
        const token = await getAccessToken();
        if (!token || cancelled) return;

        await wsClient.connect();

        unsubscribeInvite = wsClient.subscribe("call.invite", async (payload) => {
          try {
            const invite = callService.parseIncomingInvite(payload);
            if (!invite) return;

            const callerName =
              payload?.caller_name ??
              payload?.callerName ??
              "Incoming call";

            const callerRole =
              payload?.caller_role ??
              payload?.callerRole ??
              null;

            const fallbackContact = buildFallbackContact(
              invite.callerUserId === null || invite.callerUserId === undefined
                ? undefined
                : Number(invite.callerUserId),
              callerName,
              callerRole
            );

            incomingCallService.show(
              {
                ...invite,
                callerName,
                callerRole,
              },
              fallbackContact
            );

            if (invite.callerUserId) {
              try {
                const resolvedContact = await callService.resolveIncomingContact(
                  Number(invite.callerUserId)
                );

                if (resolvedContact) {
                  incomingCallService.patchContact(invite.callId, resolvedContact);
                }
              } catch (resolveError) {
                console.warn(
                  "resolveIncomingContact failed, using fallback contact",
                  resolveError
                );
              }
            }
          } catch (error) {
            console.error("Failed to process incoming call invite", error);
          }
        });

        const clearIfSame = (payload: any) => {
          const callId = Number(payload?.call_id ?? payload?.callId);
          if (!Number.isFinite(callId)) return;
          incomingCallService.clear(callId);
        };

        unsubscribeCanceled = wsClient.subscribe("call.canceled", clearIfSame);
        unsubscribeTimeout = wsClient.subscribe("call.timeout", clearIfSame);
        unsubscribeEnded = wsClient.subscribe("call.ended", clearIfSame);
      } catch (error) {
        console.warn("Incoming call WS setup skipped or failed", error);
      }
    }

    setupIncomingCallWs();

    return () => {
      cancelled = true;
      unsubscribeInvite();
      unsubscribeCanceled();
      unsubscribeTimeout();
      unsubscribeEnded();
    };
  }, []);

  const invite = state.invite;
  const contact = state.contact;

  if (!invite) {
    return null;
  }

  const currentInvite = invite;

  const name = contact?.name ?? currentInvite.callerName ?? "Incoming call";
  const role =
    contact?.role ??
    contact?.specialty ??
    currentInvite.callerRole ??
    "";
  const initials =
    contact?.initials ??
    String(name)
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  const avatarColor = contact?.avatarColor ?? "#4C6EF5";
  const kind = currentInvite.kind === "video" ? "video" : "audio";
  const kindLabel =
    kind === "video" ? "Incoming video call" : "Incoming audio call";
  const countdownLabel = getCountdownLabel(currentInvite.expiresAt);

  const contactId =
    contact?.id ??
    String(currentInvite.callerUserId ?? currentInvite.callId ?? "unknown");

  const acceptedContact: CallContact = contact ?? {
    id: contactId,
    userId:
      currentInvite.callerUserId === null ||
      currentInvite.callerUserId === undefined
        ? undefined
        : Number(currentInvite.callerUserId),
    name,
    initials,
    role,
    specialty: "",
    lastSeen: "",
    online: true,
    avatarColor,
    conversationId: undefined,
  };

  const statusLabel =
    busyAction === "accept"
      ? "Connecting secure call..."
      : busyAction === "decline"
        ? "Declining..."
        : countdownLabel;

  async function handleAccept() {
    try {
      setBusyAction("accept");
      incomingCallService.setPhase("accepting");

      const session = await callService.acceptCall(
        currentInvite.callId,
        acceptedContact
      );

      incomingCallService.clear(currentInvite.callId);

      miniCallService.setState({
        active: true,
        minimized: false,
        mode: kind,
        callId: session.callId,
        contactId: acceptedContact.id,
        contactName: acceptedContact.name,
        startedAtMs: session.startedAtMs,
        statusText: session.consultationStatus,
      });

      router.push({
        pathname:
          kind === "video"
            ? "/call/video/[contactId]"
            : "/call/audio/[contactId]",
        params: {
          contactId: acceptedContact.id,
          callId: String(session.callId),
          contactName: acceptedContact.name,
          contactUserId: acceptedContact.userId ? String(acceptedContact.userId) : "",
          contactRole: acceptedContact.role || acceptedContact.specialty || "",
        },
      });
    } catch (error) {
      console.error("Failed to accept incoming call", error);
      incomingCallService.setPhase("ringing");
    } finally {
      setBusyAction("");
    }
  }

  async function handleDecline() {
    try {
      setBusyAction("decline");
      incomingCallService.setPhase("declining");
      await callService.declineCall(currentInvite.callId);
    } catch (error) {
      console.error("Failed to decline incoming call", error);
    } finally {
      setBusyAction("");
      incomingCallService.clear(currentInvite.callId);
    }
  }

  const actionsDisabled = busyAction !== "";

  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            {
              paddingTop: Math.max(insets.top, 18),
              paddingBottom: Math.max(insets.bottom, 22),
            },
          ]}
        >
          <View style={styles.handle} />

          <View style={styles.badgeRow}>
            <View style={styles.kindBadge}>
              <Feather
                name={kind === "video" ? "video" : "phone-call"}
                size={14}
                color={colors.surface}
              />
              <Text style={styles.kindBadgeText}>{kindLabel}</Text>
            </View>
          </View>

          <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>

          <Text style={styles.name}>{name}</Text>

          {!!role ? (
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>{role}</Text>
            </View>
          ) : null}

          <Text style={styles.statusText}>{statusLabel}</Text>

          <View style={styles.actionsRow}>
            <Pressable
              style={[styles.circleAction, styles.declineCircle]}
              onPress={handleDecline}
              disabled={actionsDisabled}
            >
              {busyAction === "decline" ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Feather name="phone-off" size={24} color={colors.surface} />
              )}
            </Pressable>

            <Pressable
              style={[styles.circleAction, styles.acceptCircle]}
              onPress={handleAccept}
              disabled={actionsDisabled}
            >
              {busyAction === "accept" ? (
                <ActivityIndicator color={colors.surface} />
              ) : kind === "video" ? (
                <Feather name="video" size={24} color={colors.surface} />
              ) : (
                <Feather name="phone-call" size={24} color={colors.surface} />
              )}
            </Pressable>
          </View>

          <View style={styles.actionLabels}>
            <Text style={styles.actionLabel}>Decline</Text>
            <Text style={styles.actionLabel}>Accept</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(3, 11, 24, 0.54)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#0C1830",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    alignItems: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.24,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
  handle: {
    width: 54,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginBottom: 18,
  },
  badgeRow: {
    width: "100%",
    alignItems: "center",
    marginBottom: 22,
  },
  kindBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(124, 145, 219, 0.24)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  kindBadgeText: {
    marginLeft: 8,
    color: colors.surface,
    fontSize: 13,
    fontWeight: "700",
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  avatarText: {
    color: colors.surface,
    fontSize: 30,
    fontWeight: "800",
  },
  name: {
    color: colors.surface,
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
  },
  rolePill: {
    marginTop: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  rolePillText: {
    color: "#D7E3FF",
    fontSize: 13,
    fontWeight: "600",
  },
  statusText: {
    marginTop: 18,
    color: "#AFC3EE",
    fontSize: 15,
    textAlign: "center",
    minHeight: 22,
  },
  actionsRow: {
    width: "100%",
    marginTop: 30,
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
  },
  circleAction: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: "center",
    justifyContent: "center",
  },
  declineCircle: {
    backgroundColor: "#E5484D",
  },
  acceptCircle: {
    backgroundColor: "#1FA971",
  },
  actionLabels: {
    width: "100%",
    marginTop: 12,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
  },
  actionLabel: {
    width: 100,
    textAlign: "center",
    color: colors.surface,
    fontSize: 14,
    fontWeight: "700",
  },
});