import AsyncStorage from "@react-native-async-storage/async-storage";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { Stack } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "@/constants/theme";
import { convex, convexUrl } from "@/lib/convex";
import { DeviceProvider } from "@/lib/device";
import { clearAuthOnFreshInstall } from "@/lib/first-launch";

const secureStorage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

export default function RootLayout() {
  const [storageReady, setStorageReady] = useState(Platform.OS === "web");

  useEffect(() => {
    if (Platform.OS === "web") return;
    clearAuthOnFreshInstall(AsyncStorage, SecureStore, convexUrl)
      .catch(() => {})
      .finally(() => setStorageReady(true));
  }, []);

  if (!storageReady) return null;
  return (
    <ConvexAuthProvider client={convex} storage={Platform.OS === "web" ? undefined : secureStorage}>
      <DeviceProvider>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="welcome" options={{ animation: "none", gestureEnabled: false }} />
            <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
            <Stack.Screen name="sign-in" />
            <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
            <Stack.Screen name="event/[id]" />
          </Stack>
        </SafeAreaProvider>
      </DeviceProvider>
    </ConvexAuthProvider>
  );
}
