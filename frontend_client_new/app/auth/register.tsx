import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Alert } from "react-native";
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
import { Feather } from "@expo/vector-icons";
import { authService } from "../../src/services/authService";

export default function RegisterScreen() {
  const [email, setEmail] = useState("johnsmith@gmail.com");
  const [phone, setPhone] = useState("04123456789");
  const [password, setPassword] = useState("XXXXXXXX");
  const [confirmPassword, setConfirmPassword] = useState("XXXXXXXX");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    setError("");

    try {
      setLoading(true);
      await authService.register({
            email,
            phone,
            password,
            confirmPassword,
      });

      Alert.alert("Registration successful", "Please log in to continue.", [
        {
            text: "OK",
            onPress: () => router.replace("/auth/login"),
        },
      ]);
      router.replace("/auth/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Register failed");
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

            <Text style={styles.title}>Register</Text>
            <Text style={styles.subtitle}>Enter your details to register</Text>

            <View style={styles.form}>
              <TextInput
                style={styles.input}
                placeholder="johnsmith@gmail.com"
                placeholderTextColor="#6D7587"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />

              <View style={styles.phoneRow}>
                <Text style={styles.countryCode}>🇦🇺  ▾</Text>
                <TextInput
                  style={styles.phoneInput}
                  placeholder="04123456789"
                  placeholderTextColor="#6D7587"
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={setPhone}
                />
              </View>

              <TextInput
                style={styles.input}
                placeholder="XXXXXXXX"
                placeholderTextColor="#6D7587"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />

              <TextInput
                style={styles.input}
                placeholder="XXXXXXXX"
                placeholderTextColor="#6D7587"
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />

              {!!error && <Text style={styles.errorText}>{error}</Text>}

              <Pressable
                style={styles.primaryBtn}
                onPress={handleRegister}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>Register</Text>
                )}
              </Pressable>
            </View>

            <View style={styles.loginPromptWrap}>
              <Text style={styles.loginPromptText}>
                already have account continue{"\n"}with log in
              </Text>
            </View>

            <Text style={styles.dividerText}>Or register with</Text>

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
    marginBottom: 26,
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
    color: "#4E5670",
    marginBottom: 24,
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
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderColor: "#7B8196",
    borderRadius: 14,
    height: 58,
    paddingHorizontal: 14,
    marginBottom: 18,
  },
  countryCode: {
    color: "#526273",
    fontSize: 16,
  },
  phoneInput: {
    flex: 1,
    color: "#526273",
    fontSize: 16,
  },
  errorText: {
    color: "#D9534F",
    fontSize: 14,
    marginBottom: 8,
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
  loginPromptWrap: {
    width: "100%",
    marginTop: 8,
    marginBottom: 22,
  },
  loginPromptText: {
    textAlign: "left",
    color: "#526273",
    fontSize: 16,
    lineHeight: 24,
  },
  dividerText: {
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
});