import * as Location from "expo-location";

import { BAY_AREA_CITIES, inBayArea, nearestCity } from "@/convex/lib/geo";

export type Role = "student" | "investor" | "host";
export type Place = { city: string; lat: number; lng: number; locationSource: "device" | "city" };

export const ROLE_DEFAULT_INTERESTS: Record<Role, string[]> = {
  student: ["hackathons", "pitch", "networking"],
  investor: ["pitch", "vc", "ai"],
  host: ["hackathons", "networking", "careers"],
};

export const AREAS = BAY_AREA_CITIES;

export const cityPlace = (name: string): Place | null => {
  const c = BAY_AREA_CITIES.find((x) => x.name === name);
  return c ? { city: c.name, lat: c.lat, lng: c.lng, locationSource: "city" } : null;
};

export async function locateDevice(): Promise<{ place: Place } | { error: string }> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return { error: "Location is off. Pick an area instead, or turn it on in Settings" };
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (!inBayArea(coords)) return { error: "Scout covers the Bay Area for now. Pick an area instead" };
    return { place: { city: nearestCity(coords).name, ...coords, locationSource: "device" } };
  } catch {
    return { error: "Couldn't find your location. Pick an area instead" };
  }
}
