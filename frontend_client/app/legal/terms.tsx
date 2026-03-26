import { ScrollView, Text, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors } from "../../src/theme/colors";
import { spacing } from "../../src/theme/spacing";
import { typography } from "../../src/theme/typography";

export default function TermsOfUseScreen() {
  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <Pressable onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Terms of Use</Text>
        <Text style={styles.body}>
          These Terms of Use govern your use of the Sphere Care client application. By creating an account, you
          agree to use the service responsibly and to provide accurate information.
        </Text>
        <Text style={styles.body}>
          Replace this placeholder with your organisation&apos;s legal terms. Consult qualified counsel before
          publishing production text.
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
