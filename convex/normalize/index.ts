import type { Infer } from "convex/values";
import { geocodeQuery, inBayArea, lookupCity, nearestCity, type GeoHit, type Geocoder } from "../lib/geo";
import { httpsUrl } from "../lib/media";
import type { RawEvent, RawLocation } from "../lib/rawEvent";
import { isRelevant, rulesEnricher, type Enricher } from "../lib/tagger";
import type { normalizedEvent } from "../schema";

export type NormalizedEvent = Infer<typeof normalizedEvent>;

export type NormalizeOptions = { enricher?: Enricher; geocode?: Geocoder };

export type Located = { lat?: number; lng?: number; city: string };

export async function locate(loc: RawLocation, geocode?: Geocoder): Promise<Located | null> {
  let lat = loc.lat;
  let lng = loc.lng;
  const known = lookupCity([loc.city, loc.name, loc.address].filter(Boolean).join(" "));
  let hit: GeoHit | null = null;
  if (lat === undefined || lng === undefined) {
    const query = geocodeQuery(loc);
    hit = known ? { lat: known.lat, lng: known.lng } : geocode && query ? await geocode(query) : null;
    lat = hit?.lat;
    lng = hit?.lng;
  }
  if (lat === undefined || lng === undefined) return { city: known?.name ?? loc.city ?? "" };
  if (!inBayArea({ lat, lng })) return null;
  return { lat, lng, city: known?.name ?? loc.city ?? hit?.city ?? nearestCity({ lat, lng }).name };
}

export async function normalize(raw: RawEvent, { enricher = rulesEnricher, geocode }: NormalizeOptions = {}): Promise<NormalizedEvent | null> {
  const startTime = Date.parse(raw.startsAt);
  if (Number.isNaN(startTime)) return null;
  const endTime = raw.endsAt ? Date.parse(raw.endsAt) : undefined;
  const loc = raw.location;

  const place = loc.online ? { lat: loc.lat, lng: loc.lng, city: "Online" } : await locate(loc, geocode);
  if (!place) return null;
  const { lat, lng, city } = place;

  const hosts = raw.hosts ?? [];
  const enrichment = await enricher.enrich({
    title: raw.title,
    description: raw.description,
    organizer: raw.organizer,
    hosts,
    sourceTags: raw.sourceTags ?? [],
    sourceEventType: raw.sourceEventType,
  });
  if (!isRelevant(enrichment)) return null;

  return {
    title: raw.title,
    description: raw.description,
    startTime,
    endTime: endTime !== undefined && !Number.isNaN(endTime) ? endTime : undefined,
    timezone: raw.timezone,
    venue: loc.online ? undefined : loc.name,
    address: loc.address,
    lat,
    lng,
    city,
    isOnline: loc.online,
    url: raw.url,
    imageUrl: raw.imageUrl,
    organizerLogoUrl: httpsUrl(raw.organizerLogoUrl),
    source: raw.source,
    sourceId: raw.sourceId,
    organizer: raw.organizer,
    hosts,
    ...enrichment,
  };
}
