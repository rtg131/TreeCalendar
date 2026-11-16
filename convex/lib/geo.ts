import type { RawLocation } from "./rawEvent";

export type City = { name: string; lat: number; lng: number };

export type GeoHit = { lat: number; lng: number; city?: string };

export type Geocoder = (query: string) => Promise<GeoHit | null>;

export const BAY_AREA_CITIES: City[] = [
  { name: "San Francisco", lat: 37.7749, lng: -122.4194 },
  { name: "Palo Alto", lat: 37.4419, lng: -122.143 },
  { name: "Stanford", lat: 37.4275, lng: -122.1697 },
  { name: "Berkeley", lat: 37.8715, lng: -122.273 },
  { name: "Oakland", lat: 37.8044, lng: -122.2712 },
  { name: "San Jose", lat: 37.3382, lng: -121.8863 },
  { name: "Mountain View", lat: 37.3861, lng: -122.0839 },
  { name: "Menlo Park", lat: 37.453, lng: -122.1817 },
  { name: "Sunnyvale", lat: 37.3688, lng: -122.0363 },
  { name: "Santa Clara", lat: 37.3541, lng: -121.9552 },
  { name: "Redwood City", lat: 37.4852, lng: -122.2364 },
  { name: "San Mateo", lat: 37.563, lng: -122.3255 },
  { name: "Cupertino", lat: 37.323, lng: -122.0322 },
  { name: "Fremont", lat: 37.5485, lng: -121.9886 },
  { name: "South San Francisco", lat: 37.6547, lng: -122.4077 },
  { name: "Santa Cruz", lat: 36.9741, lng: -122.0308 },
];

export const DEFAULT_CITY = BAY_AREA_CITIES[0];

export const BAY_AREA_CENTER = { lat: 37.6, lng: -122.2 };
export const BAY_AREA_RADIUS_KM = 110;

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function inBayArea(p: { lat: number; lng: number }): boolean {
  return distanceKm(p, BAY_AREA_CENTER) <= BAY_AREA_RADIUS_KM;
}

export function lookupCity(text: string): City | undefined {
  const lower = text.toLowerCase();
  return [...BAY_AREA_CITIES]
    .sort((a, b) => b.name.length - a.name.length)
    .find((c) => lower.includes(c.name.toLowerCase()));
}

export function nearestCity(p: { lat: number; lng: number }): City {
  return BAY_AREA_CITIES.reduce((best, c) => (distanceKm(p, c) < distanceKm(p, best) ? c : best));
}


export function foldText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function geocodeQuery(loc: RawLocation): string {
  const head = loc.address ?? loc.name;
  const rest = [loc.city, loc.region, loc.country].filter((p): p is string => !!p && !foldText(head ?? "").includes(foldText(p)));
  return [head, ...rest].filter(Boolean).join(", ");
}
