import { useQuery } from "convex/react";
import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { Brand } from "@/components/brand";
import { colors } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import { useDeviceId } from "@/lib/device";

export default function Index() {
  const deviceId = useDeviceId();
  const profile = useQuery(api.users.get, deviceId ? { deviceId } : "skip");

  if (!deviceId || profile === undefined) {
    return (
      <View style={styles.center}>
        <Brand size={36} />
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  return <Redirect href={profile ? "/feed" : "/welcome"} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 20, backgroundColor: colors.bg },
});
