import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Feather, MaterialIcons } from "@expo/vector-icons";

import type { TranscriptItem } from "../../types/call";
import { colors } from "../../theme/colors";
import { typography } from "../../theme/typography";

type TranscriptMode = "speech" | "asl";
type AslGestureMode = "static" | "motion";

type TranscriptPanelProps = {
  items: TranscriptItem[];
  transcribing: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  containerStyle?: StyleProp<ViewStyle>;
  title?: string;
  mode?: TranscriptMode;
  onModeChange?: (mode: TranscriptMode) => void;
  showModeTabs?: boolean;
  aslMode?: AslGestureMode;
  onToggleAslMode?: () => void;
  onClearAsl?: () => void;
  onSpaceAsl?: () => void;
  aslLiveLetter?: string;
  aslConfidence?: number;
};

export default function TranscriptPanel({
  items,
  transcribing,
  expanded,
  onToggleExpanded,
  containerStyle,
  title = "AI Live Transcript",
  mode = "speech",
  onModeChange,
  showModeTabs = false,
  aslMode = "static",
  onToggleAslMode,
  onClearAsl,
  onSpaceAsl,
  aslLiveLetter,
  aslConfidence,
}: TranscriptPanelProps) {
  const isAslMode = mode === "asl";

  return (
    <View style={[styles.panel, containerStyle]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <MaterialIcons name="smart-toy" size={20} color="#2E3340" />
          <Text style={styles.title}>{title}</Text>
        </View>

        <Pressable onPress={onToggleExpanded}>
          <Feather
            name={expanded ? "chevron-down" : "chevron-up"}
            size={18}
            color="#727B89"
          />
        </Pressable>
      </View>

      {showModeTabs ? (
        <View style={styles.modeTabs}>
          <Pressable
            style={[styles.modeTab, !isAslMode && styles.modeTabActive]}
            onPress={() => onModeChange?.("speech")}
          >
            <Text
              style={[
                styles.modeTabText,
                !isAslMode && styles.modeTabTextActive,
              ]}
            >
              🎤 Speech
            </Text>
          </Pressable>

          <Pressable
            style={[styles.modeTab, isAslMode && styles.modeTabActive]}
            onPress={() => onModeChange?.("asl")}
          >
            <Text
              style={[
                styles.modeTabText,
                isAslMode && styles.modeTabTextActive,
              ]}
            >
              👋 ASL
            </Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {!transcribing ? (
          <Text style={styles.emptyText}>AI transcript is paused.</Text>
        ) : items.length === 0 ? (
          <Text style={styles.emptyText}>
            {isAslMode ? "Waiting for ASL signs..." : "Listening for transcript..."}
          </Text>
        ) : (
          items.map((item) => (
            <View key={item.id} style={styles.bubble}>
              <Text style={styles.speaker}>{item.speaker}</Text>
              <Text style={styles.text}>{item.content}</Text>
            </View>
          ))
        )}
      </ScrollView>

      {isAslMode ? (
        <View style={styles.aslFooter}>
          <View style={styles.aslDetailRow}>
            <Text style={styles.aslLetter}>{aslLiveLetter || "—"}</Text>
            <Text style={styles.aslConfidence}>
              {typeof aslConfidence === "number"
                ? `${Math.round(aslConfidence * 100)}%`
                : ""}
            </Text>
          </View>

          <View style={styles.aslControls}>
            <Pressable style={styles.aslMiniButton} onPress={onToggleAslMode}>
              <Text style={styles.aslMiniButtonText}>
                {aslMode === "static" ? "Static A-Z" : "Motion Words"}
              </Text>
            </Pressable>
            <Pressable style={styles.aslMiniButton} onPress={onClearAsl}>
              <Text style={styles.aslMiniButtonText}>Clear</Text>
            </Pressable>
            <Pressable style={styles.aslMiniButton} onPress={onSpaceAsl}>
              <Text style={styles.aslMiniButtonText}>Space</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  modeTabs: {
    flexDirection: "row",
    alignSelf: "center",
    gap: 6,
    marginBottom: 10,
  },
  modeTab: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 5,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  modeTabActive: {
    backgroundColor: "rgba(56,189,248,0.92)",
  },
  modeTabText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.surface,
  },
  modeTabTextActive: {
    color: "#0F172A",
  },
  body: {
    flex: 1,
  },
  content: {
    paddingBottom: 6,
  },
  bubble: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
  },
  speaker: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4A5FC1",
    marginBottom: 4,
  },
  text: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  emptyText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textMuted,
  },
});