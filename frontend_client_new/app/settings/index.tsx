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
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";
import PageHeader from "../../src/components/PageHeader";

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
        <View style={styles.topRow}>
          <PageHeader title="Settings" />
        </View>

        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
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
        <View style={styles.iconWrap}>{renderIcon(item.icon, isDanger)}</View>

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
          trackColor={{ false: colors.borderStrong, true: colors.successLight }}
          thumbColor={item.value ? colors.success : colors.surface}
        />
      ) : isDanger ? null : (
        <Feather name="chevron-right" size={28} color={colors.textMuted} />
      )}
    </Pressable>
  );
}

function renderIcon(icon: SettingRow["icon"], isDanger: boolean) {
  const color = isDanger ? "#CC2A1F" : colors.textPrimary;

  switch (icon) {
    case "moon":
      return <Feather name="moon" size={28} color={color} />;
    case "lock":
      return <Feather name="lock" size={28} color={color} />;
    case "fingerprint":
      return (
        <MaterialCommunityIcons name="fingerprint" size={30} color={color} />
      );
    case "shield":
      return <Feather name="shield" size={28} color={color} />;
    case "help":
      return (
        <Ionicons
          name="information-circle-outline"
          size={30}
          color={color}
        />
      );
    case "document":
      return <Ionicons name="document-text-outline" size={28} color={color} />;
    case "info":
      return <AntDesign name="question-circle" size={26} color={color} />;
    case "logout":
      return <MaterialIcons name="logout" size={28} color={color} />;
    default:
      return <Feather name="circle" size={24} color={color} />;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundAlt,
  },
  scrollContent: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  pageTitle: {
    ...typography.pageTitle,
    textAlign: "center",
    marginBottom: spacing.xxxl,
  },
  topRow: {
    marginBottom: 28,
  },
  loaderWrap: {
    paddingTop: 40,
    alignItems: "center",
  },
  sectionTitle: {
    ...typography.sectionTitle,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  card: {
    minHeight: 92,
    borderRadius: 20,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border,
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
    marginRight: spacing.md,
  },
  textWrap: {
    flex: 1,
  },
  cardTitle: {
    ...typography.cardTitle,
  },
  dangerTitle: {
    color: "#CC2A1F",
    textAlign: "center",
  },
  cardSubtitle: {
    ...typography.subText,
    marginTop: spacing.xs,
  },
  signOutWrap: {
    marginTop: 34,
  },
});