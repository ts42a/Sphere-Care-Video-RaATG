import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { messageService } from "../../services/messageService";
import type { CallContact, CallSession, TranscriptItem } from "../../types/call";
import {
  buildCallSummaryDocument,
  downloadCallSummaryDocument,
  encodeCallSummaryMessage,
  type CallSummaryMessagePayload,
} from "../../utils/callSummaryDocument";
import { colors } from "../../theme/colors";
import { spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";

type Props = {
  visible: boolean;
  onClose: () => void;
  session: CallSession;
  contact: CallContact;
  transcriptItems: TranscriptItem[];
  formattedDuration: string;
};

function formatDate(value: number) {
  const date = new Date(value || Date.now());
  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function transcriptToText(items: TranscriptItem[]) {
  return items
    .filter((item) => item.content?.trim())
    .map((item) => `${item.speaker || item.role || "Speaker"}: ${item.content.trim()}`)
    .join("\n");
}

function buildSummaryText(items: TranscriptItem[]) {
  const transcript = transcriptToText(items);

  if (!transcript) {
    return "No transcript was captured for this call. Please add notes manually if required.";
  }

  const highlights = items
    .filter((item) => item.content?.trim())
    .slice(-6)
    .map((item) => `• ${item.content.trim()}`);

  return [
    "AI summary draft based on the available transcript:",
    "",
    ...highlights,
    "",
    "Please verify important clinical details before saving or sharing this summary.",
  ].join("\n");
}

export default function CallSummaryModal({
  visible,
  onClose,
  session,
  contact,
  transcriptItems,
  formattedDuration,
}: Props) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const payload = useMemo<CallSummaryMessagePayload>(() => {
    const callType = session.mode === "video" ? "Video" : "Audio";
    const patientName = session.patient?.name || "Patient";
    const providerName = contact.name || session.doctor?.name || "Provider";

    return {
      version: 1,
      callId: session.callId,
      callType,
      title: `${callType} call summary with ${providerName}`,
      dateLabel: formatDate(session.startedAtMs),
      durationLabel: formattedDuration || "N/A",
      providerName,
      patientName,
      summaryText: buildSummaryText(transcriptItems),
      transcriptText: transcriptToText(transcriptItems),
      generatedAt: new Date().toISOString(),
    };
  }, [contact.name, formattedDuration, session, transcriptItems]);

  const documentText = useMemo(() => buildCallSummaryDocument(payload), [payload]);

  async function handleSendToMessages() {
    const conversationId = session.conversationId || contact.conversationId;
    if (!conversationId || sending) return;

    try {
      setSending(true);
      await messageService.sendMessage(String(conversationId), encodeCallSummaryMessage(payload));
      setSent(true);
    } catch (error) {
      console.error("Failed to send call summary to messages", error);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <View style={styles.root}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>Post-call AI summary</Text>
            <Text style={styles.title}>Review summary</Text>
          </View>
          <Pressable accessibilityRole="button" style={styles.closeButton} onPress={onClose}>
            <Feather name="x" size={24} color={colors.textPrimary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>Call</Text>
            <Text style={styles.metaValue}>{payload.callType} · {payload.durationLabel}</Text>
            <Text style={styles.metaLabel}>Provider</Text>
            <Text style={styles.metaValue}>{payload.providerName}</Text>
            <Text style={styles.metaLabel}>Patient</Text>
            <Text style={styles.metaValue}>{payload.patientName}</Text>
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.sectionTitle}>Summary</Text>
            <Text style={styles.summaryText}>{payload.summaryText}</Text>
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.sectionTitle}>Document preview</Text>
            <Text style={styles.documentText}>{documentText}</Text>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            style={[styles.secondaryButton, sending && styles.disabledButton]}
            onPress={() => downloadCallSummaryDocument(payload)}
          >
            <Feather name="download" size={18} color={colors.primary} />
            <Text style={styles.secondaryButtonText}>Download</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={sending || sent || !(session.conversationId || contact.conversationId)}
            style={[styles.primaryButton, (sending || sent || !(session.conversationId || contact.conversationId)) && styles.disabledButton]}
            onPress={handleSendToMessages}
          >
            {sending ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Feather name={sent ? "check" : "send"} size={18} color="#FFFFFF" />}
            <Text style={styles.primaryButtonText}>{sent ? "Sent" : "Send to messages"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingTop: 56,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  kicker: {
    ...typography.subText,
    color: colors.textSecondary,
  },
  title: {
    ...typography.pageTitle,
    color: colors.textPrimary,
    marginTop: 4,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5F9",
  },
  content: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  metaCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  metaLabel: {
    ...typography.subText,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  metaValue: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "700",
    marginTop: 2,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  summaryText: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  documentText: {
    ...typography.subText,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  footer: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    gap: spacing.md,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  secondaryButtonText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: "700",
  },
  primaryButton: {
    flex: 1.4,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  primaryButtonText: {
    ...typography.body,
    color: "#FFFFFF",
    fontWeight: "800",
  },
  disabledButton: {
    opacity: 0.55,
  },
});
