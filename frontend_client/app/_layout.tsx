import { useEffect, useState } from "react";
import { Stack, usePathname, useRouter } from "expo-router";
import { ActivityIndicator, View, StyleSheet } from "react-native";
import { getAccessToken } from "../src/services/sessionService";
import MiniCallBar from "../src/components/call/MiniCallBar";

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    checkAuth();
  }, [pathname]);

  async function checkAuth() {
    try {
      const token = await getAccessToken();
      const currentPath = pathname || "";
      const isAuthPage = currentPath.startsWith("/auth");
      const isLegalPage = currentPath.startsWith("/legal");
      const guestOk = isAuthPage || isLegalPage;

      if (!token && !guestOk) {
        router.replace("/auth/login");
        return;
      }

      if (token && isAuthPage) {
        router.replace("/");
        return;
      }
    } catch (error) {
      console.error("Failed to check auth state", error);
    } finally {
      setCheckingAuth(false);
    }
  }

  if (checkingAuth) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#7C91DB" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack screenOptions={{ headerShown: false }} />
      <MiniCallBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F7F7F7",
  },
});