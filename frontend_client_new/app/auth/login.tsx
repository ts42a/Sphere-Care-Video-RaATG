import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { authService } from "../../src/services/authService";
import { Feather } from "@expo/vector-icons";

export default function LoginScreen() {
  const [email, setEmail] = useState("johnsmith@gmail.com");
  const [password, setPassword] = useState("XXXXXXXXXXX");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError("");

    if (!email || !password) {
      setError("Please enter your email and password");
      return;
    }

    try {
      setLoading(true);
      await authService.login(email, password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.screen}>
            <View style={styles.logoWrap}>
              <View style={styles.logoBox}>
                <Feather name="image" size={42} color="#596173" />
              </View>
              <Text style={styles.logoText}>LOGO</Text>
            </View>

            <Text style={styles.title}>Login</Text>
            <Text style={styles.subtitle}>
              Enter your email and password{"\n"}to login
            </Text>

            <View style={styles.form}>
              <TextInput
                style={styles.input}
                placeholder="johnsmith@gmail.com"
                placeholderTextColor="#6D7587"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
              />

              <TextInput
                style={styles.input}
                placeholder="XXXXXXXXXXX"
                placeholderTextColor="#6D7587"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />

              {!!error && <Text style={styles.errorText}>{error}</Text>}

              <Pressable
                style={styles.forgotWrap}
                onPress={() => router.push("/auth/forgot-password")}
              >
                <Text style={styles.forgotText}>Forgot Password?</Text>
              </Pressable>

              <Pressable
                style={styles.primaryBtn}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>Login</Text>
                )}
              </Pressable>
            </View>

            <Text style={styles.dividerText}>Or login in with</Text>

            <View style={styles.socialRow}>
              <Pressable style={[styles.socialBtn, styles.googleBtn]}>
                <Text style={styles.googleIcon}>G</Text>
                <Text style={styles.googleText}>Google</Text>
              </Pressable>

              <Pressable style={[styles.socialBtn, styles.facebookBtn]}>
                <Text style={styles.facebookIcon}>f</Text>
                <Text style={styles.facebookText}>Facebook</Text>
              </Pressable>
            </View>

            <View style={styles.bottomTextRow}>
              <Text style={styles.bottomText}>Don't have an account? </Text>
              <Pressable onPress={() => router.push("/auth/register")}>
                <Text style={styles.inlineLink}>Register</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F7F7",
  },
  scrollContent: {
    flexGrow: 1,
  },
  screen: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 40,
    paddingBottom: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  logoWrap: {
    marginTop: 24,
    marginBottom: 34,
    alignItems: "center",
  },
  logoBox: {
    width: 88,
    height: 68,
    borderWidth: 2,
    borderColor: "#526273",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  logoText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#526273",
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
    color: "#4E5670",
    marginBottom: 18,
  },
  subtitle: {
    textAlign: "center",
    fontSize: 16,
    fontWeight: "600",
    color: "#1F2B3D",
    marginBottom: 38,
    lineHeight: 24,
  },
  form: {
    width: "100%",
  },
  input: {
    width: "100%",
    height: 58,
    borderWidth: 1.5,
    borderColor: "#7B8196",
    borderRadius: 14,
    paddingHorizontal: 16,
    backgroundColor: "transparent",
    color: "#526273",
    marginBottom: 18,
    fontSize: 16,
  },
  errorText: {
    color: "#D9534F",
    fontSize: 14,
    marginTop: -8,
    marginBottom: 8,
  },
  forgotWrap: {
    width: "100%",
    alignItems: "flex-end",
    marginTop: -8,
    marginBottom: 18,
  },
  forgotText: {
    color: "#526273",
    fontSize: 15,
  },
  primaryBtn: {
    width: "100%",
    height: 58,
    borderRadius: 14,
    backgroundColor: "#7C91DB",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  dividerText: {
    marginTop: 24,
    marginBottom: 22,
    color: "#526273",
    textAlign: "center",
    fontSize: 16,
  },
  socialRow: {
    flexDirection: "row",
    gap: 14,
    width: "100%",
  },
  socialBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  googleBtn: {
    borderWidth: 1.5,
    borderColor: "#7B8196",
    backgroundColor: "#FFFFFF",
  },
  facebookBtn: {
    backgroundColor: "#7C91DB",
  },
  googleIcon: {
    fontSize: 22,
    fontWeight: "700",
    color: "#486146",
  },
  googleText: {
    color: "#526273",
    fontSize: 16,
    fontWeight: "700",
  },
  facebookIcon: {
    fontSize: 26,
    fontWeight: "700",
    color: "#FFFFFF",
    lineHeight: 26,
  },
  facebookText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  bottomTextRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
  },
  bottomText: {
    color: "#526273",
    fontSize: 16,
  },
  inlineLink: {
    color: "#2D3650",
    fontSize: 16,
    fontWeight: "700",
  },
});