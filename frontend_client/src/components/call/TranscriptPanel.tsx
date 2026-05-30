import { useCallback, useEffect, useRef } from "react";
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
  const scrollRef = useRef<ScrollView>(null);

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated });
    });
  }, []);

  // Always follow the newest transcript output.
  // The Latest button is removed, so new Speech / ASL messages keep the panel at the bottom.
  useEffect(() => {
    scrollToBottom(true);
  }, [items.length, items[items.length - 1]?.content, mode, expanded, scrollToBottom]);

  const handleContentSizeChange = useCallback(() => {
    scrollToBottom(true);
  }, [scrollToBottom]);

  return (
    <View style={[styles.panel, containerStyle]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <MaterialIcons
            name={isAslMode ? "sign-language" : "smart-toy"}
            size={16}
            color={colors.primary}
          />
          <Text style={styles.title}>{title}</Text>
          {transcribing && <View style={styles.liveDot} />}
        </View>
        <Pressable
          onPress={onToggleExpanded}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather
            name={expanded ? "chevron-down" : "chevron-up"}
            size={18}
            color={colors.textMuted}
          />
        </Pressable>
      </View>

      {/* Mode tabs */}
      {showModeTabs && (
        <View style={styles.modeTabs}>
          <Pressable
            style={[styles.modeTab, !isAslMode && styles.modeTabActive]}
            onPress={() => onModeChange?.("speech")}
          >
            <Feather
              name="mic"
              size={11}
              color={!isAslMode ? colors.surface : colors.textMuted}
            />
            <Text
              style={[styles.modeTabText, !isAslMode && styles.modeTabTextActive]}
            >
              Speech
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeTab, isAslMode && styles.modeTabActive]}
            onPress={() => onModeChange?.("asl")}
          >
            <MaterialIcons
              name="sign-language"
              size={11}
              color={isAslMode ? colors.surface : colors.textMuted}
            />
            <Text
              style={[styles.modeTabText, isAslMode && styles.modeTabTextActive]}
            >
              ASL
            </Text>
          </Pressable>
        </View>
      )}

      {/* Scrollable transcript body */}
      <View style={styles.bodyWrap}>
        <ScrollView
          ref={scrollRef}
          style={styles.body}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={handleContentSizeChange}
        >
          {!transcribing ? (
            <View style={styles.emptyWrap}>
              <MaterialIcons
                name="pause-circle-outline"
                size={18}
                color={colors.textMuted}
              />
              <Text style={styles.emptyText}>Transcript paused</Text>
            </View>
          ) : items.length === 0 ? (
            <View style={styles.emptyWrap}>
              <MaterialIcons
                name={isAslMode ? "sign-language" : "graphic-eq"}
                size={18}
                color={colors.textMuted}
              />
              <Text style={styles.emptyText}>
                {isAslMode ? "Waiting for ASL signs…" : "Listening…"}
              </Text>
            </View>
          ) : (
            items.map((item) => {
              const isLocal = item.role === "patient";
              return (
                <View
                  key={`${item.id}-${item.segmentId ?? ""}`}
                  style={[styles.bubble, isLocal && styles.bubbleLocal]}
                >
                  <View style={styles.bubbleHeader}>
                    <Text
                      style={[styles.speaker, isLocal && styles.speakerLocal]}
                    >
                      {item.speaker}
                    </Text>
                    {item.source === "asl" && (
                      <View style={styles.aslBadge}>
                        <Text style={styles.aslBadgeText}>ASL</Text>
                      </View>
                    )}
                    {item.isFinal === false && (
                      <Text style={styles.interimDots}>…</Text>
                    )}
                  </View>
                  <Text style={styles.bubbleText}>{item.content}</Text>
                </View>
              );
            })
          )}
        </ScrollView>

      </View>

      {/* ASL footer */}
      {isAslMode && (
        <View style={styles.aslFooter}>
          <View style={styles.aslLiveRow}>
            <View style={styles.aslLetterBox}>
              <Text style={styles.aslLetter}>{aslLiveLetter || "—"}</Text>
            </View>
            <View style={styles.aslMeta}>
              <Text style={styles.aslMetaLabel}>Detected letter</Text>
              <Text style={styles.aslConfidence}>
                {typeof aslConfidence === "number"
                  ? `${Math.round(aslConfidence * 100)}% confidence`
                  : "No signal"}
              </Text>
            </View>
            <View style={{ flex: 1 }} />
            <Pressable style={styles.aslModeChip} onPress={onToggleAslMode}>
              <Text style={styles.aslModeChipText}>
                {aslMode === "static" ? "Static" : "Motion"}
              </Text>
            </Pressable>
          </View>
          <View style={styles.aslControls}>
            <Pressable style={styles.aslChip} onPress={onSpaceAsl}>
              <Text style={styles.aslChipText}>+ Space</Text>
            </Pressable>
            <Pressable
              style={[styles.aslChip, styles.aslChipDanger]}
              onPress={onClearAsl}
            >
              <Text style={[styles.aslChipText, styles.aslChipTextDanger]}>
                Clear
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    paddingTop: 12,
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textSecondary,
    letterSpacing: 0.1,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  modeTabs: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 8,
  },
  modeTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: colors.backgroundAlt,
  },
  modeTabActive: {
    backgroundColor: colors.primary,
  },
  modeTabText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  modeTabTextActive: {
    color: colors.surface,
  },
  bodyWrap: {
    flex: 1,
    position: "relative",
    minHeight: 60,
  },
  body: {
    flex: 1,
  },
  content: {
    gap: 6,
    paddingBottom: 8,
  },
  emptyWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
  },
  emptyText: {
    ...typography.subText,
    fontSize: 13,
    color: colors.textMuted,
  },
  bubble: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleLocal: {
    backgroundColor: "#EEF2FF",
    borderColor: "#D6DEFF",
  },
  bubbleHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 3,
  },
  speaker: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  speakerLocal: {
    color: colors.primary,
  },
  aslBadge: {
    backgroundColor: "#E0EAFF",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  aslBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: colors.primary,
    letterSpacing: 0.4,
  },
  interimDots: {
    fontSize: 13,
    color: colors.textMuted,
    marginLeft: "auto" as any,
  },
  bubbleText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  // ASL footer
  aslFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    marginTop: 8,
    gap: 8,
  },
  aslLiveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  aslLetterBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#D6DEFF",
    alignItems: "center",
    justifyContent: "center",
  },
  aslLetter: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.primary,
  },
  aslMeta: {
    gap: 1,
  },
  aslMetaLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  aslConfidence: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  aslModeChip: {
    backgroundColor: "#EEF2FF",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#D6DEFF",
  },
  aslModeChipText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.primary,
  },
  aslControls: {
    flexDirection: "row",
    gap: 6,
  },
  aslChip: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  aslChipDanger: {
    borderColor: "#FCA5A5",
    backgroundColor: "#FFF5F5",
  },
  aslChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  aslChipTextDanger: {
    color: colors.danger,
  },
});