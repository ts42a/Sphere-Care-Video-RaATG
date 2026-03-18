import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";
import { router } from "expo-router";

import PageHeader from "../../src/components/PageHeader";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";

export default function PasswordResetSuccessScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.screen}>
          <PageHeader title="Password reset" />

          <Text style={styles.pageDesc}>
            Your password has been successfully reset. click{"\n"}
            confirm to set a new password
          </Text>

          <Pressable
            style={styles.primaryBtn}
            onPress={() => router.replace("/auth/login")}
          >
            <Text style={styles.primaryBtnText}>Confirm</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  screen: {
    flex: 1,
    paddingHorizontal: spacing.xxl,
    paddingTop: 32,
    paddingBottom: 40,
  },
  pageDesc: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing.xxxl,
    lineHeight: 28,
  },
  primaryBtn: {
    width: "100%",
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  primaryBtnText: {
    ...typography.button,
  },
});