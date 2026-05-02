import { ScrollView, Text, StyleSheet, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";

export default function TermsOfUseScreen() {
  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Demo legal document</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Sphere Care Terms of Use</Text>
        <Text style={styles.updated}>Demo version for interface testing</Text>

        <Text style={styles.sectionTitle}>1. Use of the app</Text>
        <Text style={styles.body}>
          Sphere Care is designed to help clients, families, and care teams manage bookings, calls, messages,
          reminders, and care-related notifications. You agree to use the app only for lawful and appropriate care
          communication purposes.
        </Text>

        <Text style={styles.sectionTitle}>2. Account information</Text>
        <Text style={styles.body}>
          You must provide accurate registration details, including contact information, emergency contact details,
          and guardian information where required. You are responsible for keeping your account password secure.
        </Text>

        <Text style={styles.sectionTitle}>3. Care information</Text>
        <Text style={styles.body}>
          Information shown in the app may support care coordination, but it does not replace professional medical
          advice. In an emergency, contact local emergency services immediately.
        </Text>

        <Text style={styles.sectionTitle}>4. Communication features</Text>
        <Text style={styles.body}>
          Messages, calls, notifications, and booking requests may be shared with relevant care staff or authorised
          administrators so they can provide support. You should not send abusive, misleading, or unsafe content.
        </Text>

        <Text style={styles.sectionTitle}>5. Demo notice</Text>
        <Text style={styles.body}>
          This text is a placeholder for development and presentation. Before production release, replace it with
          final legal terms approved by the organisation or legal adviser.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  backButton: { alignSelf: "flex-start", paddingVertical: spacing.xs },
  backText: { ...typography.cardTitle, color: colors.primary, fontSize: 18 },
  headerTitle: { ...typography.subText, color: colors.textMuted, marginTop: spacing.xs },
  scroll: { paddingHorizontal: spacing.xxxl, paddingTop: spacing.xxl, paddingBottom: spacing.xxxl },
  title: { ...typography.pageTitle, marginBottom: spacing.sm },
  updated: { ...typography.subText, color: colors.textMuted, marginBottom: spacing.xl },
  sectionTitle: { ...typography.cardTitle, color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.sm },
  body: { ...typography.body, marginBottom: spacing.md, color: colors.textSecondary, lineHeight: 23 },
});
