import { ScrollView, Text, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";

export default function PrivacyPolicyScreen() {
  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <Pressable onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Privacy Policy</Text>
        <Text style={styles.body}>
          This policy describes how Sphere Care handles personal and health-related information you provide during
          registration and while using the app.
        </Text>
        <Text style={styles.body}>
          Replace this placeholder with your organisation&apos;s privacy policy, including data retention, sharing,
          and your contact details for privacy enquiries.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  back: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  backText: { ...typography.cardTitle, color: colors.primary },
  scroll: { paddingHorizontal: spacing.xxxl, paddingBottom: spacing.xxl },
  title: { ...typography.pageTitle, marginBottom: spacing.lg },
  body: { ...typography.body, marginBottom: spacing.md, color: colors.textSecondary },
});
