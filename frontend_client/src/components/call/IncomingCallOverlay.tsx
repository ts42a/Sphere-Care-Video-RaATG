import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { getAccessToken } from "../../services/sessionService";
import { wsClient } from "../../services/wsClient";
import { callService } from "../../services/callService";
import { incomingCallService } from "../../services/call/incomingCallService";
import { miniCallService } from "../../services/miniCallService";
import { colors } from "../../theme/colors";

type OverlayState = any;

function useIncomingCallState() {
  const [state, setState] = useState<OverlayState>(() => {
    try {
      return incomingCallService?.getState?.() ?? null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const unsubscribe = incomingCallService?.subscribe?.((next: OverlayState) => {
      setState(next ?? null);
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  return state;
}

export default function IncomingCallOverlay() {
  const state = useIncomingCallState();
  const [busyAction, setBusyAction] = useState<"accept" | "decline" | "">("");

    useEffect(() => {
    let unsubscribeInvite = () => {};
    let unsubscribeCanceled = () => {};
    let unsubscribeTimeout = () => {};
    let unsubscribeEnded = () => {};
    let cancelled = false;

    async function setupIncomingCallWs() {
      try {
        const token = await getAccessToken();
        if (!token || cancelled) {
          return;
        }

        await wsClient.connect();

        unsubscribeInvite = wsClient.subscribe("call.invite", async (payload) => {
          try {
            console.log("call.invite received on client", payload);

            const callId = Number(payload?.call_id ?? payload?.callId);
            if (!callId) return;

            const callerUserIdRaw = payload?.caller_user_id ?? payload?.callerUserId;
            const callerUserId =
              callerUserIdRaw === undefined || callerUserIdRaw === null
                ? undefined
                : Number(callerUserIdRaw);

            const callerName =
              payload?.caller_name ??
              payload?.callerName ??
              "Incoming call";

            const kind = payload?.kind === "video" ? "video" : "audio";

            const invitePayload = {
              callId,
              kind,
              callerUserId,
              callerName,
              callerRole: payload?.caller_role ?? payload?.callerRole ?? null,
              expiresAt: payload?.expires_at ?? payload?.expiresAt ?? null,
            };

            const fallbackContact = {
              id: String(callerUserId ?? callId),
              userId: callerUserId,
              name: callerName,
              initials: String(callerName)
                .split(" ")
                .map((part: string) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase(),
              role: payload?.caller_role ?? payload?.callerRole ?? "",
              specialty: "",
              avatarColor: "#4C6EF5",
              conversationId: undefined,
            };

            incomingCallService.show(invitePayload as any, fallbackContact as any);

            if (callerUserId) {
              try {
                const resolvedContact = await callService.resolveIncomingContact(callerUserId);
                if (resolvedContact) {
                  incomingCallService.show(invitePayload as any, resolvedContact as any);
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
          const currentState = incomingCallService.getState();
          const activeInvite = currentState?.invite ?? null;

          const callId = Number(payload?.call_id ?? payload?.callId);
          const currentCallId = Number(activeInvite?.callId);

          if (!activeInvite || !callId || currentCallId !== callId) {
            return;
          }

          incomingCallService.clear();
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

  const { invite, contact } = useMemo(() => {
    return {
      invite: state?.invite ?? null,
      contact: state?.contact ?? null,
    };
  }, [state]);

  if (!invite) {
    return null;
  }

  const fallbackName =
    contact?.name ??
    invite?.callerName ??
    invite?.caller_name ??
    "Incoming call";

  const fallbackInitials =
    contact?.initials ??
    String(fallbackName)
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  const fallbackRole =
    contact?.role ??
    contact?.specialty ??
    invite?.callerRole ??
    invite?.caller_role ??
    "";

  const kind = invite?.kind === "video" ? "video" : "audio";
  const contactId =
    contact?.id ??
    String(
      invite?.callerUserId ??
        invite?.caller_user_id ??
        invite?.callId ??
        invite?.call_id ??
        "unknown"
    );

  async function handleAccept() {
    try {
      setBusyAction("accept");

      const callId = Number(invite?.callId ?? invite?.call_id);
      const acceptedContact = contact ?? {
        id: contactId,
        name: fallbackName,
        initials: fallbackInitials,
        role: fallbackRole,
      };

      const session = await callService.acceptCall(callId, acceptedContact);

      incomingCallService?.clear?.();

      miniCallService.setState({
        active: true,
        minimized: false,
        mode: kind,
        callId: session.callId,
        contactId: acceptedContact.id,
        contactName: acceptedContact.name,
      });

      router.push({
        pathname: kind === "video" ? "/call/video/[contactId]" : "/call/audio/[contactId]",
        params: {
          contactId: acceptedContact.id,
          callId: String(session.callId),
        },
      });
    } catch (error) {
      console.error("Failed to accept incoming call", error);
    } finally {
      setBusyAction("");
    }
  }

  async function handleDecline() {
    try {
      setBusyAction("decline");
      const callId = Number(invite?.callId ?? invite?.call_id);
      await callService.declineCall(callId);
    } catch (error) {
      console.error("Failed to decline incoming call", error);
    } finally {
      setBusyAction("");
      incomingCallService?.clear?.();
    }
  }

  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{fallbackInitials}</Text>
          </View>

          <Text style={styles.kicker}>Incoming {kind} call</Text>
          <Text style={styles.name}>{fallbackName}</Text>
          {!!fallbackRole && <Text style={styles.role}>{fallbackRole}</Text>}

          <View style={styles.actions}>
            <Pressable
              style={[styles.actionBtn, styles.declineBtn]}
              onPress={handleDecline}
              disabled={busyAction !== ""}
            >
              <Feather name="phone-off" size={22} color={colors.surface} />
              <Text style={styles.actionText}>Decline</Text>
            </Pressable>

            <Pressable
              style={[styles.actionBtn, styles.acceptBtn]}
              onPress={handleAccept}
              disabled={busyAction !== ""}
            >
              <Feather name="phone-call" size={22} color={colors.surface} />
              <Text style={styles.actionText}>Accept</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(8, 25, 54, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 28,
    backgroundColor: colors.surface,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    alignItems: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  avatarText: {
    color: colors.surface,
    fontSize: 28,
    fontWeight: "700",
  },
  kicker: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
    marginBottom: 8,
    textTransform: "capitalize",
  },
  name: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: 6,
  },
  role: {
    fontSize: 15,
    color: colors.textPrimary,
    textAlign: "center",
    marginBottom: 24,
  },
  actions: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 14,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  declineBtn: {
    backgroundColor: colors.danger,
  },
  acceptBtn: {
    backgroundColor: colors.success,
  },
  actionText: {
    marginTop: 8,
    color: colors.surface,
    fontSize: 15,
    fontWeight: "700",
  },
});