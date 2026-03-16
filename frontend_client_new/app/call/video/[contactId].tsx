import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Feather, MaterialIcons, AntDesign } from "@expo/vector-icons";

import { callService } from "../../../src/services/callService";

import type { CallContact } from "../../../src/types/call";

export default function VideoCallScreen() {
  const { contactId } = useLocalSearchParams<{ contactId: string }>();

  const [contact, setContact] = useState<CallContact | null>(null);
  const [transcriptLines, setTranscriptLines] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (contactId) {
      loadInitialData(contactId);

      callService.startVideoCall(contactId).catch((error) => {
        console.error("Failed to start video call", error);
      });
    }
  }, [contactId]);

  useEffect(() => {
    if (!contactId) return;

    const interval = setInterval(() => {
      refreshTranscript(contactId);
    }, 4000);

    return () => clearInterval(interval);
  }, [contactId]);

  async function loadInitialData(id: string) {
    try {
      setLoading(true);

      const [contactData, transcriptData] = await Promise.all([
        callService.getContactById(id),
        callService.getTranscript(id),
      ]);

      setContact(contactData);
      setTranscriptLines(transcriptData);
    } catch (error) {
      console.error("Failed to load video call data", error);
    } finally {
      setLoading(false);
    }
  }

  async function refreshTranscript(id: string) {
    try {
      const transcriptData = await callService.getTranscript(id);
      setTranscriptLines(transcriptData);
    } catch (error) {
      console.error("Failed to refresh transcript", error);
    }
  }

  if (loading || !contact) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FFFFFF" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topbar}>
        <View style={styles.timerWrap}>
          <View style={styles.redDot} />
          <Text style={styles.timerText}>00:30</Text>
        </View>

        <View style={styles.aiPill}>
          <Text style={styles.aiPillText}>AI Transcribing</Text>
        </View>
      </View>

      <Text style={styles.smallName}>{contact.name}</Text>
      <Text style={styles.quality}>HD Quality</Text>

      <View style={styles.mainProfile}>
        <View
          style={[
            styles.mainAvatar,
            { backgroundColor: contact.avatarColor },
          ]}
        >
          <Text style={styles.mainAvatarText}>{contact.initials}</Text>
        </View>

        <Text style={styles.mainName}>{contact.name}</Text>
        <Text style={styles.mainRole}>{contact.specialty}</Text>
      </View>

      <View
        style={[
          styles.transcriptPanel,
          expanded ? styles.transcriptExpanded : null,
        ]}
      >
        <View style={styles.transcriptHeader}>
          <View style={styles.transcriptTitleRow}>
            <MaterialIcons name="smart-toy" size={24} color="#2E3340" />
            <Text style={styles.transcriptTitle}>AI Live Transcript</Text>
            <View style={styles.liveDot} />
          </View>

          <View style={styles.transcriptActions}>
            <Pressable>
              <Feather name="copy" size={20} color="#727B89" />
            </Pressable>

            <Pressable>
              <Feather name="download" size={20} color="#727B89" />
            </Pressable>

            <Pressable onPress={() => setExpanded((prev) => !prev)}>
              <AntDesign
                name={expanded ? "down" : "up"}
                size={18}
                color="#727B89"
              />
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={styles.transcriptBody}
          showsVerticalScrollIndicator={false}
        >
          {transcriptLines.map((line, index) => (
            <View key={`${line}-${index}`} style={styles.transcriptBubble}>
              <Text style={styles.transcriptText}>{line}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      <View style={styles.bottomControls}>
        <ControlItem
          label="Mute"
          icon={<Feather name="mic-off" size={28} color="#FFFFFF" />}
          onPress={() => {}}
        />

        <ControlItem
          label="End"
          center
          icon={<Feather name="phone-off" size={28} color="#FFFFFF" />}
          onPress={() => router.replace("/call")}
        />

        <ControlItem
          label="Stop"
          icon={<Feather name="video-off" size={28} color="#FFFFFF" />}
          onPress={() => {}}
        />
      </View>
    </SafeAreaView>
  );
}

function ControlItem({
  label,
  icon,
  onPress,
  center,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  center?: boolean;
}) {
  return (
    <View style={styles.controlItem}>
      <Pressable
        onPress={onPress}
        style={center ? styles.endButton : styles.controlButton}
      >
        {icon}
      </Pressable>
      <Text style={styles.controlLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: "#081936",
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    flex: 1,
    backgroundColor: "#081936",
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  timerWrap: {
    flexDirection: "row",
    alignItems: "center",
  },
  redDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#E53E3E",
    marginRight: 10,
  },
  timerText: {
    fontSize: 17,
    color: "#FFFFFF",
  },
  aiPill: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#DCE3FF",
  },
  aiPillText: {
    fontSize: 16,
    color: "#2F3441",
    fontWeight: "500",
  },
  smallName: {
    fontSize: 18,
    color: "#FFFFFF",
    marginBottom: 8,
  },
  quality: {
    fontSize: 16,
    color: "#00E05A",
    marginBottom: 42,
  },
  mainProfile: {
    alignItems: "center",
    marginBottom: 28,
  },
  mainAvatar: {
    width: 190,
    height: 190,
    borderRadius: 95,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
    shadowColor: "#4A7CFF",
    shadowOpacity: 0.4,
    shadowRadius: 18,
  },
  mainAvatarText: {
    color: "#FFFFFF",
    fontSize: 52,
    fontWeight: "700",
  },
  mainName: {
    fontSize: 22,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 8,
  },
  mainRole: {
    fontSize: 17,
    color: "#C9CED8",
  },
  transcriptPanel: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    paddingTop: 18,
    paddingBottom: 12,
    paddingHorizontal: 16,
    height: 220,
    marginTop: "auto",
  },
  transcriptExpanded: {
    height: 400,
  },
  transcriptHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#E7E9EE",
  },
  transcriptTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  transcriptTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#2E3340",
    marginLeft: 10,
  },
  liveDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#35C85A",
    marginLeft: 12,
  },
  transcriptActions: {
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
  transcriptBody: {
    paddingTop: 16,
  },
  transcriptBubble: {
    backgroundColor: "#EEF7F0",
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },
  transcriptText: {
    fontSize: 16,
    color: "#2F3441",
    lineHeight: 30,
  },
  bottomControls: {
    paddingTop: 18,
    paddingBottom: 24,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    backgroundColor: "transparent",
  },
  controlItem: {
    alignItems: "center",
  },
  controlButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  endButton: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: "#EF2626",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  controlLabel: {
    fontSize: 16,
    color: "#FFFFFF",
  },
});