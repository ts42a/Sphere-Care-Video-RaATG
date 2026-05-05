import { useEffect, useMemo, useState } from "react";
import { Stack, usePathname, useRouter } from "expo-router";
import { ActivityIndicator, View, StyleSheet } from "react-native";

import { getAccessToken } from "../src/services/sessionService";
import MiniCallBar from "../src/components/call/MiniCallBar";
import IncomingCallOverlay from "../src/components/call/IncomingCallOverlay";
import CallLifecycleBridge from "../src/components/call/CallLifecycleBridge";
import { notificationService } from "../src/services/notificationService";
import { pushNotificationService } from "../src/services/pushNotificationService";

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    void checkAuth();
  }, [pathname]);

  async function checkAuth() {
    try {
      const token = await getAccessToken();
      const currentPath = pathname || "";
      const isAuthPage = currentPath.startsWith("/auth");
      const isLegalPage = currentPath.startsWith("/legal");
      const guestOk = isAuthPage || isLegalPage;

      setHasToken(!!token);

      if (!token && !guestOk) {
        router.replace("/auth/login");
        return;
      }
    } catch (error) {
      console.error("Failed to check auth state", error);
      setHasToken(false);
    } finally {
      setCheckingAuth(false);
    }
  }


  useEffect(() => {
    if (!hasToken) return;

    pushNotificationService.configureHandler();
    notificationService.initializeRealtime();

    return () => {
      notificationService.resetRealtime();
    };
  }, [hasToken]);

  const showRealtimeUi = useMemo(() => {
    const currentPath = pathname || "";
    const isAuthPage = currentPath.startsWith("/auth");
    const isLegalPage = currentPath.startsWith("/legal");
    return hasToken && !isAuthPage && !isLegalPage;
  }, [hasToken, pathname]);

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
      {showRealtimeUi ? <CallLifecycleBridge /> : null}
      {showRealtimeUi ? <IncomingCallOverlay /> : null}
      {showRealtimeUi ? <MiniCallBar /> : null}
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