import { ScrollView, Text, StyleSheet, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";

export default function PrivacyPolicyScreen() {
  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Demo legal document</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Sphere Care Privacy Policy</Text>
        <Text style={styles.updated}>Demo version for interface testing</Text>

        <Text style={styles.sectionTitle}>1. Information we collect</Text>
        <Text style={styles.body}>
          During registration, Sphere Care may collect your name, email, phone number, date of birth, address,
          guardian details, emergency contacts, centre ID, and communication preferences.
        </Text>

        <Text style={styles.sectionTitle}>2. How information is used</Text>
        <Text style={styles.body}>
          Your information is used to create your account, support booking and messaging features, contact you about
          important care updates, and help authorised staff manage care-related communication.
        </Text>

        <Text style={styles.sectionTitle}>3. Who can access it</Text>
        <Text style={styles.body}>
          Relevant care staff, approved administrators, and authorised support personnel may access information needed
          to provide the service. Access should be limited to appropriate care and operational purposes.
        </Text>

        <Text style={styles.sectionTitle}>4. Security and retention</Text>
        <Text style={styles.body}>
          The app should use reasonable technical and organisational safeguards to protect personal information. Data
          retention rules should be defined by the organisation before production release.
        </Text>

        <Text style={styles.sectionTitle}>5. Demo notice</Text>
        <Text style={styles.body}>
          This policy is placeholder content for development and presentation. Replace it with a final privacy policy
          before releasing the app to real users.
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
