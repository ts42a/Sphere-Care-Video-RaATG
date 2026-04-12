import { View, Text, StyleSheet } from "react-native";

import { colors } from "../../theme/colors";
import { typography } from "../../theme/typography";

type CallParticipantCardProps = {
  initials: string;
  name: string;
  subtitle: string;
  status?: string;
  avatarColor?: string;
  large?: boolean;
  dark?: boolean;
  showOnlineDot?: boolean;
};

export default function CallParticipantCard({
  initials,
  name,
  subtitle,
  status,
  avatarColor = "#D9D9D9",
  large = false,
  dark = false,
  showOnlineDot = false,
}: CallParticipantCardProps) {
  const avatarSize = large ? 170 : 112;
  const avatarRadius = avatarSize / 2;

  const nameColor = dark ? colors.surface : colors.textSecondary;
  const subtitleColor = dark ? "#AFC0E8" : colors.textMuted;

  return (
    <View style={styles.wrapper}>
      <View style={styles.avatarWrap}>
        <View
          style={[
            styles.avatar,
            {
              width: avatarSize,
              height: avatarSize,
              borderRadius: avatarRadius,
              backgroundColor: avatarColor,
            },
          ]}
        >
          <Text style={[styles.avatarText, large ? styles.avatarTextLarge : null]}>
            {initials}
          </Text>
        </View>

        {showOnlineDot ? <View style={styles.onlineDot} /> : null}
      </View>

      <Text
        style={[
          styles.name,
          { color: nameColor },
          large ? styles.nameLarge : null,
        ]}
        numberOfLines={1}
      >
        {name}
      </Text>

      <Text style={[styles.subtitle, { color: subtitleColor }]} numberOfLines={1}>
        {subtitle}
      </Text>

      {status ? (
        <View style={styles.statusPill}>
          <Text style={styles.statusText} numberOfLines={1}>
            {status}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
  },
  avatarWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  avatar: {
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 30,
    fontWeight: "700",
    color: colors.surface,
  },
  avatarTextLarge: {
    fontSize: 44,
  },
  onlineDot: {
    position: "absolute",
    right: 6,
    bottom: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: colors.background,
  },
  name: {
    ...typography.pageTitle,
    textAlign: "center",
    width: "100%",
    marginBottom: 4,
  },
  nameLarge: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 6,
  },
  subtitle: {
    ...typography.body,
    textAlign: "center",
    width: "100%",
    marginBottom: 8,
  },
  statusPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#EEF8F2",
    maxWidth: "90%",
  },
  statusText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.success,
  },
});