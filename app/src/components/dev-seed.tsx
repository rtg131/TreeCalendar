import { useQuery } from "convex/react";
import { router, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { colors } from "@/constants/theme";
import { api } from "@/convex/_generated/api";
import { useDeviceId } from "@/lib/device";
import type { Role } from "@/lib/profile";

const SETTLE_MS = 1500;

export type SeedTab = "feed" | "map" | "saved" | "inbox" | "profile";
export type SeedTarget = { tab: SeedTab; push?: Href };

type Props<T> = {
  role: Role;
  seed: (deviceId: string) => Promise<T>;
  open: (result: T) => SeedTarget;
};

export function DevSeed<T>({ role, seed, open }: Props<T>) {
  const deviceId = useDeviceId();
  const profile = useQuery(api.users.get, deviceId ? { deviceId } : "skip");
  const started = useRef(false);
  const [target, setTarget] = useState<SeedTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId || started.current) return;
    started.current = true;
    seed(deviceId)
      .then((result) => setTarget(open(result)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [deviceId, seed, open]);

  const ready = !!target && profile !== undefined;
  const mismatch = ready && profile?.role !== role ? `Seeded profile is ${profile?.role ?? "missing"}, expected ${role}` : null;

  useEffect(() => {
    if (!target || !ready || mismatch) return;
    const timer = setTimeout(() => {
      if (router.canDismiss()) router.dismissAll();
      router.replace(`/${target.tab}`);
      if (target.push) router.push(target.push);
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [target, ready, mismatch]);

  return (
    <View style={styles.center}>
      {error ?? mismatch ? <Text style={styles.error}>Seeding failed: {error ?? mismatch}</Text> : <ActivityIndicator color={colors.brand} />}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.bg },
  error: { color: colors.danger, textAlign: "center" },
});
