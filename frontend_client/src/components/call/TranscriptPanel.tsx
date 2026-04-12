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

type TranscriptPanelProps = {
  items: TranscriptItem[];
  transcribing: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  containerStyle?: StyleProp<ViewStyle>;
  title?: string;
};

export default function TranscriptPanel({
  items,
  transcribing,
  expanded,
  onToggleExpanded,
  containerStyle,
  title = "AI Live Transcript",
}: TranscriptPanelProps) {
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

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {!transcribing ? (
          <Text style={styles.emptyText}>AI transcript is paused.</Text>
        ) : items.length === 0 ? (
          <Text style={styles.emptyText}>Listening for transcript...</Text>
        ) : (
          items.map((item) => (
            <View key={item.id} style={styles.bubble}>
              <Text style={styles.speaker}>{item.speaker}</Text>
              <Text style={styles.text}>{item.content}</Text>
            </View>
          ))
        )}
      </ScrollView>
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