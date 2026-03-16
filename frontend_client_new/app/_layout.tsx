import { useEffect, useState } from "react";
import { Stack, usePathname, useRouter } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { getAccessToken } from "../src/services/sessionService";

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

      if (!token && !isAuthPage) {
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
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#F7F7F7",
        }}
      >
        <ActivityIndicator size="large" color="#7C91DB" />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}