import { useEffect, useMemo, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import {
  Feather,
  Ionicons,
  MaterialIcons,
  MaterialCommunityIcons,
  AntDesign,
} from "@expo/vector-icons";

import type { SettingRow } from "../../src/types/setting";
import { settingService } from "../../src/services/settingService";

export default function SettingsScreen() {
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);
      const data = await settingService.getSettings();
      setSettings(data);
    } catch (error) {
      console.error("Failed to load settings", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(item: SettingRow, nextValue: boolean) {
    if (!item.settingKey) return;

    try {
      setBusyKey(item.id);

      setSettings((prev) =>
        prev.map((row) =>
          row.id === item.id ? { ...row, value: nextValue } : row
        )
      );

      await settingService.updateToggle(item.settingKey, nextValue);
    } catch (error) {
      console.error("Failed to update setting", error);

      setSettings((prev) =>
        prev.map((row) =>
          row.id === item.id ? { ...row, value: !nextValue } : row
        )
      );
    } finally {
      setBusyKey("");
    }
  }

  async function handlePress(item: SettingRow) {
    if (item.type === "danger") {
      Alert.alert("Sign Out", "Are you sure you want to sign out?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out",
          style: "destructive",
          onPress: async () => {
            try {
              await settingService.signOut();
              router.replace("/auth/login");
            } catch (error) {
              console.error("Failed to sign out", error);
            }
          },
        },
      ]);
      return;
    }

    if (item.route) {
      router.push(item.route as never);
    }
  }

  const appearanceItems = useMemo(
    () => settings.filter((item) => item.section === "appearance"),
    [settings]
  );

  const securityItems = useMemo(
    () => settings.filter((item) => item.section === "security"),
    [settings]
  );

  const supportItems = useMemo(
    () => settings.filter((item) => item.section === "support"),
    [settings]
  );

  const accountItems = useMemo(
    () => settings.filter((item) => item.section === "account"),
    [settings]
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.pageTitle}>Settings</Text>

        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color="#46576D" />
          </View>
        ) : (
          <>
            {appearanceItems.map((item) => (
              <SettingsCard
                key={item.id}
                item={item}
                busy={busyKey === item.id}
                onToggle={handleToggle}
                onPress={handlePress}
              />
            ))}

            <Text style={styles.sectionTitle}>Security & Privacy</Text>
            {securityItems.map((item) => (
              <SettingsCard
                key={item.id}
                item={item}
                busy={busyKey === item.id}
                onToggle={handleToggle}
                onPress={handlePress}
              />
            ))}

            <Text style={styles.sectionTitle}>Support</Text>
            {supportItems.map((item) => (
              <SettingsCard
                key={item.id}
                item={item}
                busy={busyKey === item.id}
                onToggle={handleToggle}
                onPress={handlePress}
              />
            ))}

            <View style={styles.signOutWrap}>
              {accountItems.map((item) => (
                <SettingsCard
                  key={item.id}
                  item={item}
                  busy={false}
                  onToggle={handleToggle}
                  onPress={handlePress}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingsCard({
  item,
  busy,
  onToggle,
  onPress,
}: {
  item: SettingRow;
  busy: boolean;
  onToggle: (item: SettingRow, nextValue: boolean) => void;
  onPress: (item: SettingRow) => void;
}) {
  const isDanger = item.type === "danger";
  const isToggle = item.type === "toggle";

  return (
    <Pressable
      disabled={isToggle}
      onPress={() => onPress(item)}
      style={[styles.card, isDanger && styles.dangerCard]}
    >
      <View style={styles.leftRow}>
        <View style={styles.iconWrap}>
          {renderIcon(item.icon, isDanger)}
        </View>

        <View style={styles.textWrap}>
          <Text style={[styles.cardTitle, isDanger && styles.dangerTitle]}>
            {item.title}
          </Text>
          {!!item.subtitle && (
            <Text style={styles.cardSubtitle}>{item.subtitle}</Text>
          )}
        </View>
      </View>

      {isToggle ? (
        <Switch
          value={!!item.value}
          onValueChange={(nextValue) => onToggle(item, nextValue)}
          disabled={busy}
          trackColor={{ false: "#D9DDE3", true: "#C9F2D5" }}
          thumbColor={item.value ? "#22B24C" : "#FFFFFF"}
        />
      ) : isDanger ? null : (
        <Feather name="chevron-right" size={28} color="#A0A8B4" />
      )}
    </Pressable>
  );
}

function renderIcon(icon: SettingRow["icon"], isDanger: boolean) {
  const color = isDanger ? "#CC2A1F" : "#11192D";

  switch (icon) {
    case "moon":
      return <Feather name="moon" size={28} color={color} />;
    case "lock":
      return <Feather name="lock" size={28} color={color} />;
    case "fingerprint":
      return <MaterialCommunityIcons name="fingerprint" size={30} color={color} />;
    case "shield":
      return <Feather name="shield" size={28} color={color} />;
    case "help":
      return <Ionicons name="information-circle-outline" size={30} color={color} />;
    case "document":
      return <Ionicons name="document-text-outline" size={28} color={color} />;
    case "info":
      return <AntDesign name="questioncircleo" size={26} color={color} />;
    case "logout":
      return <MaterialIcons name="logout" size={28} color={color} />;
    default:
      return <Feather name="circle" size={24} color={color} />;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F3F5",
  },
  scrollContent: {
    paddingTop: 18,
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  pageTitle: {
    textAlign: "center",
    fontSize: 28,
    fontWeight: "700",
    color: "#11192D",
    marginBottom: 26,
  },
  loaderWrap: {
    paddingTop: 40,
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1C2435",
    marginTop: 18,
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  card: {
    minHeight: 92,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    marginBottom: 14,
    paddingHorizontal: 20,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#E6E8EB",
  },
  dangerCard: {
    backgroundColor: "#FFF4F3",
    borderColor: "#F3D6D2",
    justifyContent: "center",
  },
  leftRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  iconWrap: {
    width: 42,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  textWrap: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1C2435",
  },
  dangerTitle: {
    color: "#CC2A1F",
    textAlign: "center",
  },
  cardSubtitle: {
    marginTop: 4,
    fontSize: 14,
    color: "#9AA3AF",
  },
  signOutWrap: {
    marginTop: 34,
  },
});