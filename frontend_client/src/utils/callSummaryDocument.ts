import { Alert, Platform, Share } from "react-native";
import * as FileSystem from "expo-file-system";

export const CALL_SUMMARY_MESSAGE_PREFIX = "__SPHERE_CALL_SUMMARY__";

export type CallSummaryMessagePayload = {
  version: 1;
  callId?: number | string | null;
  callType: "Audio" | "Video" | string;
  title: string;
  dateLabel: string;
  durationLabel: string;
  providerName: string;
  patientName: string;
  summaryText: string;
  transcriptText?: string;
  generatedAt: string;
};

function safeFileName(value: string) {
  return value.replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

export function encodeCallSummaryMessage(payload: CallSummaryMessagePayload) {
  return `${CALL_SUMMARY_MESSAGE_PREFIX}${JSON.stringify(payload)}`;
}

export function parseCallSummaryMessage(
  text?: string | null,
  messageType?: string | null
): CallSummaryMessagePayload | null {
  if (!text) return null;

  const raw = text.trim();
  if (raw.startsWith(CALL_SUMMARY_MESSAGE_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(CALL_SUMMARY_MESSAGE_PREFIX.length));
      if (parsed && typeof parsed === "object" && parsed.summaryText) {
        return parsed as CallSummaryMessagePayload;
      }
    } catch {
      return null;
    }
  }

  if (messageType === "call_summary") {
    return {
      version: 1,
      callType: "Call",
      title: "AI Call Summary",
      dateLabel: "",
      durationLabel: "",
      providerName: "Provider",
      patientName: "Patient",
      summaryText: raw,
      generatedAt: new Date().toISOString(),
    };
  }

  return null;
}

export function buildCallSummaryDocument(payload: CallSummaryMessagePayload) {
  const transcript = payload.transcriptText?.trim();

  return [
    "SphereCare AI Call Summary",
    "",
    `Title: ${payload.title}`,
    `Call type: ${payload.callType}`,
    `Date: ${payload.dateLabel}`,
    `Duration: ${payload.durationLabel}`,
    `Provider: ${payload.providerName}`,
    `Patient: ${payload.patientName}`,
    `Generated at: ${new Date(payload.generatedAt).toLocaleString()}`,
    "",
    "Summary",
    payload.summaryText.trim(),
    "",
    "Transcript",
    transcript || "No transcript was captured for this call.",
    "",
    "Note: This document was generated from the available real time transcript. Please verify important clinical details before relying on it.",
  ].join("\n");
}

export async function downloadCallSummaryDocument(payload: CallSummaryMessagePayload) {
  const documentText = buildCallSummaryDocument(payload);
  const baseName = safeFileName(
    `SphereCare_${payload.callType}_Summary_${payload.dateLabel || new Date().toISOString().slice(0, 10)}`
  );
  const fileName = `${baseName || "SphereCare_Call_Summary"}.txt`;

  try {
    if (Platform.OS === "android" && FileSystem.StorageAccessFramework) {
      const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (permission.granted) {
        const uri = await FileSystem.StorageAccessFramework.createFileAsync(
          permission.directoryUri,
          fileName,
          "text/plain"
        );
        await FileSystem.writeAsStringAsync(uri, documentText, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        Alert.alert("Summary downloaded", `Saved as ${fileName}.`);
        return;
      }
    }

    const cacheUri = `${FileSystem.cacheDirectory}${fileName}`;
    await FileSystem.writeAsStringAsync(cacheUri, documentText, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    await Share.share({
      title: payload.title || "SphereCare Call Summary",
      message: documentText,
      url: cacheUri,
    });
  } catch (error) {
    console.error("Failed to download call summary", error);
    Alert.alert("Download failed", "Unable to save this summary. Please try again.");
  }
}
