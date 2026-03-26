import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
} from "react-native";

import PageHeader from "../../src/components/PageHeader";
import { getStoredUser } from "../../src/services/sessionService";
import { centerMembershipService } from "../../src/services/centerMembershipService";
import type { AuthUser } from "../../src/types/auth";
import type { CenterMembershipStatus, CenterJoinRequest } from "../../src/types/centerMembership";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";

function buildAccountId(user: AuthUser | null) {
  if (user?.unique_code) {
    return `ACC-${user.unique_code}`;
  }
  if (user?.id !== undefined && user?.id !== null) {
    const raw = String(user.id).replace(/[^a-zA-Z0-9]/g, "");
    return `ACC-${raw.toUpperCase()}`;
  }
  return "ACC-?";
}

export default function AccountSettingsScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [respondingId, setRespondingId] = useState<number | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [joinCenter, setJoinCenter] = useState("");
  const [membership, setMembership] = useState<CenterMembershipStatus | null>(null);
  const [invitations, setInvitations] = useState<CenterJoinRequest[]>([]);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [modalPassword, setModalPassword] = useState("");
  const passwordResolverRef = useRef<((value: string | null) => void) | null>(null);

  const refreshData = useCallback(async () => {
    try {
      const [status, invites] = await Promise.all([
        centerMembershipService.getStatus().catch(() => null),
        centerMembershipService.getInvitations().catch(() => []),
      ]);
      setMembership(status);
      setInvitations(invites);
    } catch {
      setMembership(null);
      setInvitations([]);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const storedUser = await getStoredUser<AuthUser>();
        setUser(storedUser);
        await refreshData();
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshData]);

  const accountId = useMemo(() => buildAccountId(user), [user]);

  async function handleSave() {
    const value = joinCenter.trim();
    if (!value) {
      if (Platform.OS === "web") { window.alert("Please enter a center code."); }
      else { Alert.alert("Join Center", "Please enter a center code."); }
      return;
    }

    try {
      setSaving(true);
      await centerMembershipService.requestJoin(value);
      await refreshData();
      if (Platform.OS === "web") { window.alert("Your join request has been sent to the center admin for approval."); }
      else { Alert.alert("Request sent", "Your join request has been sent to the center admin for approval."); }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Could not submit join request.";
      if (Platform.OS === "web") { window.alert(msg); }
      else { Alert.alert("Error", msg); }
    } finally {
      setSaving(false);
    }
  }

  async function handleLeaveCenter() {
    // Step 1: Confirm intent
    const confirmed = await new Promise<boolean>((resolve) => {
      if (Platform.OS === "web") {
        resolve(window.confirm("Are you sure you want to leave this center? This action cannot be undone."));
      } else {
        Alert.alert(
          "Leave Center",
          "Are you sure you want to leave this center? This action cannot be undone.",
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Yes, Leave", style: "destructive", onPress: () => resolve(true) },
          ]
        );
      }
    });
    if (!confirmed) return;

    // Step 2: Prompt for password
    const password = await new Promise<string | null>((resolve) => {
      if (Platform.OS === "web") {
        resolve(window.prompt("Enter your password to confirm:"));
      } else {
        Alert.prompt?.(
          "Password Required",
          "Enter your password to confirm leaving the center:",
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
            { text: "Confirm", onPress: (val?: string) => resolve(val || null) },
          ],
          "secure-text"
        );
        // Alert.prompt is iOS-only; for Android we use a state-based modal
        if (!Alert.prompt) {
          setShowPasswordModal(true);
          passwordResolverRef.current = resolve;
        }
      }
    });
    if (!password) return;

    try {
      setLeaving(true);
      await centerMembershipService.leave(password);
      await refreshData();
      if (Platform.OS === "web") { window.alert("You are no longer part of the center."); }
      else { Alert.alert("Center left", "You are no longer part of the center."); }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Could not leave center.";
      if (Platform.OS === "web") { window.alert(msg); }
      else { Alert.alert("Error", msg); }
    } finally {
      setLeaving(false);
    }
  }

  async function handleAcceptInvitation(invId: number) {
    try {
      setRespondingId(invId);
      await centerMembershipService.acceptInvitation(invId);
      await refreshData();
      if (Platform.OS === "web") { window.alert("You have joined the center!"); }
      else { Alert.alert("Joined!", "You have joined the center."); }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Could not accept invitation.";
      if (Platform.OS === "web") { window.alert(msg); }
      else { Alert.alert("Error", msg); }
    } finally {
      setRespondingId(null);
    }
  }

  async function handleRejectInvitation(invId: number) {
    try {
      setRespondingId(invId);
      await centerMembershipService.rejectInvitation(invId);
      await refreshData();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Could not decline invitation.";
      if (Platform.OS === "web") { window.alert(msg); }
      else { Alert.alert("Error", msg); }
    } finally {
      setRespondingId(null);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <PageHeader title="Account" />

        <View style={styles.card}>
          <Text style={styles.label}>Unique Account ID</Text>
          <Text selectable style={styles.accountId}>
            {accountId}
          </Text>
          <Text style={styles.helperText}>
            Share this ID with your care center admin so they can invite you.
          </Text>
        </View>

        {invitations.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.label}>Center Invitations</Text>
            <Text style={[styles.helperText, { marginBottom: spacing.md }]}>
              A care center has invited you to join. Accept to become a resident.
            </Text>
            {invitations.map((inv) => (
              <View key={inv.id} style={styles.invitationItem}>
                <Text style={styles.invCenterName}>
                  {inv.center_name || "Care Center"} ({inv.center_code})
                </Text>
                {inv.request_message ? (
                  <Text style={styles.invMessage}>{inv.request_message}</Text>
                ) : null}
                <View style={styles.invActions}>
                  <Pressable
                    style={[styles.acceptBtn, respondingId === inv.id && styles.primaryBtnDisabled]}
                    onPress={() => handleAcceptInvitation(inv.id)}
                    disabled={respondingId !== null}
                  >
                    {respondingId === inv.id ? (
                      <ActivityIndicator color={colors.surface} size="small" />
                    ) : (
                      <Text style={styles.acceptBtnText}>Accept</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={[styles.rejectBtn, respondingId === inv.id && styles.primaryBtnDisabled]}
                    onPress={() => handleRejectInvitation(inv.id)}
                    disabled={respondingId !== null}
                  >
                    <Text style={styles.rejectBtnText}>Decline</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.label}>Center Membership</Text>
          {membership?.is_member ? (
            <>
              <Text style={styles.statusApproved}>Approved</Text>
              <Text style={styles.helperText}>
                You are part of {membership.joined_center_name || "your center"} ({membership.joined_center_code}).
              </Text>
              <Pressable
                style={[styles.secondaryBtn, leaving && styles.primaryBtnDisabled]}
                onPress={handleLeaveCenter}
                disabled={leaving}
              >
                {leaving ? (
                  <ActivityIndicator color={colors.surface} />
                ) : (
                  <Text style={styles.primaryBtnText}>Leave Center</Text>
                )}
              </Pressable>
            </>
          ) : membership?.pending_request ? (
            <>
              <Text style={styles.statusPending}>Pending Approval</Text>
              <Text style={styles.helperText}>
                Request sent to {membership.pending_request.center_name} ({membership.pending_request.center_code}).
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.statusNeutral}>Not in a center</Text>
              <Text style={styles.helperText}>Submit a center ID below to request membership.</Text>
            </>
          )}
        </View>

        {(() => {
          const joinDisabled = !!(membership?.is_member || membership?.pending_request);
          return (
            <View style={[styles.card, joinDisabled && styles.cardDisabled]}>
              <Text style={styles.label}>Join Center</Text>
              {joinDisabled ? (
                <Text style={styles.helperText}>
                  {membership?.is_member
                    ? "You are already a member of a center. Leave your current center to join a new one."
                    : "You have a pending join request. Wait for approval before submitting another."}
                </Text>
              ) : (
                <>
                  <TextInput
                    value={joinCenter}
                    onChangeText={setJoinCenter}
                    placeholder="Enter center code (e.g. CTR-83749261)"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="characters"
                    style={styles.input}
                  />
                  <Text style={styles.helperText}>
                    Enter the center code provided by your care center admin.
                  </Text>

                  <Pressable
                    style={[styles.primaryBtn, saving && styles.primaryBtnDisabled]}
                    onPress={handleSave}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator color={colors.surface} />
                    ) : (
                      <Text style={styles.primaryBtnText}>Request to Join Center</Text>
                    )}
                  </Pressable>
                </>
              )}
            </View>
          );
        })()}

        {/* Password confirmation modal (Android fallback — iOS uses Alert.prompt) */}
        <Modal visible={showPasswordModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.label}>Password Required</Text>
              <Text style={styles.helperText}>Enter your password to confirm leaving the center.</Text>
              <TextInput
                value={modalPassword}
                onChangeText={setModalPassword}
                placeholder="Password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                style={[styles.input, { marginTop: spacing.md }]}
              />
              <View style={styles.modalActions}>
                <Pressable
                  style={[styles.rejectBtn, { flex: 1 }]}
                  onPress={() => {
                    setShowPasswordModal(false);
                    setModalPassword("");
                    passwordResolverRef.current?.(null);
                  }}
                >
                  <Text style={styles.rejectBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.acceptBtn, { flex: 1 }]}
                  onPress={() => {
                    setShowPasswordModal(false);
                    const pw = modalPassword;
                    setModalPassword("");
                    passwordResolverRef.current?.(pw || null);
                  }}
                >
                  <Text style={styles.acceptBtnText}>Confirm</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundAlt,
  },
  loading: {
    flex: 1,
    backgroundColor: colors.backgroundAlt,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  cardDisabled: {
    opacity: 0.5,
  },
  label: {
    ...typography.cardTitle,
    marginBottom: spacing.sm,
  },
  accountId: {
    ...typography.sectionTitle,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  helperText: {
    ...typography.subText,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  statusApproved: {
    ...typography.cardTitle,
    color: colors.success,
  },
  statusPending: {
    ...typography.cardTitle,
    color: colors.primary,
  },
  statusNeutral: {
    ...typography.cardTitle,
    color: colors.textSecondary,
  },
  input: {
    width: "100%",
    height: 56,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    color: colors.textSecondary,
    fontSize: 16,
    marginTop: spacing.sm,
  },
  primaryBtn: {
    width: "100%",
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  secondaryBtn: {
    width: "100%",
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.textSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  primaryBtnDisabled: {
    opacity: 0.7,
  },
  primaryBtnText: {
    ...typography.button,
  },
  invitationItem: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  invCenterName: {
    ...typography.cardTitle,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  invMessage: {
    ...typography.subText,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  invActions: {
    flexDirection: "row" as const,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  acceptBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.success,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  acceptBtnText: {
    ...typography.button,
    color: colors.surface,
  },
  rejectBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.border,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  rejectBtnText: {
    ...typography.button,
    color: colors.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
  },
  modalActions: {
    flexDirection: "row" as const,
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
});
