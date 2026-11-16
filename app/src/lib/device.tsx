import AsyncStorage from "@react-native-async-storage/async-storage";
import { useConvexAuth } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import * as Crypto from "expo-crypto";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api } from "@/convex/_generated/api";

const KEY = "cac.deviceId";

export const RADIUS_OPTIONS = [
  { km: 16, label: "10 mi" },
  { km: 40, label: "25 mi" },
  { km: 100, label: "Bay Area" },
] as const;

export const DEFAULT_RADIUS_KM = 100;

export const radiusLabel = (km: number) =>
  RADIUS_OPTIONS.find((o) => o.km === km)?.label ?? `${Math.round(km / 1.609)} mi`;

type Device = { deviceId: string | null; adopt: (id: string) => Promise<void>; reset: () => Promise<void> };

const DeviceContext = createContext<Device>({ deviceId: null, adopt: async () => {}, reset: async () => {} });

const newId = () => `dev_${Crypto.randomUUID()}`;

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const { isAuthenticated } = useConvexAuth();
  const accountDeviceId = useQuery(api.users.accountDeviceId, isAuthenticated ? {} : "skip");

  const adopt = useCallback(async (id: string) => {
    await AsyncStorage.setItem(KEY, id);
    setDeviceId(id);
  }, []);
  const reset = useCallback(() => adopt(newId()), [adopt]);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((stored) => (stored ? setDeviceId(stored) : reset()));
  }, [reset]);

  useEffect(() => {
    if (!accountDeviceId || !deviceId || accountDeviceId === deviceId) return;
    AsyncStorage.setItem(KEY, accountDeviceId).then(() => setDeviceId(accountDeviceId));
  }, [accountDeviceId, deviceId]);

  const value = useMemo(() => ({ deviceId, adopt, reset }), [deviceId, adopt, reset]);
  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export const useDeviceId = () => useContext(DeviceContext).deviceId;
export const useDevice = () => useContext(DeviceContext);

export function useSearchRadius() {
  const deviceId = useDeviceId();
  const user = useQuery(api.users.get, deviceId ? { deviceId } : "skip");
  const upsert = useMutation(api.users.upsert);
  const [draft, setDraft] = useState<number | null>(null);

  const setRadiusKm = useCallback(
    async (km: number) => {
      setDraft(km);
      if (!user) return;
      const { _id, _creationTime, updatedAt, name, email, phone, affiliation, linkedin, ...profile } = user;
      await upsert({ ...profile, radiusKm: km });
    },
    [user, upsert],
  );

  return { radiusKm: draft ?? user?.radiusKm ?? DEFAULT_RADIUS_KM, setRadiusKm };
}
