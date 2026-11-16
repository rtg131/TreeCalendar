import type { Adapter } from "../lib/adapter";
import { httpsUrl } from "../lib/media";
import type { RawEvent } from "../lib/rawEvent";
import { toZonedIso } from "../lib/time";

type LumaEntry = {
  event: {
    api_id: string;
    name: string;
    start_at: string;
    end_at?: string;
    timezone?: string;
    url: string;
    cover_url?: string;
    visibility?: string;
    location_type?: string;
    coordinate?: { latitude: number; longitude: number } | null;
    geo_address_info?: {
      city?: string;
      region?: string;
      country?: string;
      address?: string;
      full_address?: string;
      short_address?: string;
    } | null;
  };
  calendar?: { name?: string; is_personal?: boolean; avatar_url?: string | null } | null;
  hosts?: { name?: string | null; avatar_url?: string | null }[];
};

function findEntries(node: unknown, out: LumaEntry[]): LumaEntry[] {
  if (Array.isArray(node)) {
    node.forEach((n) => findEntries(n, out));
  } else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const ev = obj.event as LumaEntry["event"] | undefined;
    if (ev && typeof ev === "object" && typeof ev.api_id === "string" && typeof ev.start_at === "string") {
      out.push(obj as LumaEntry);
      return out;
    }
    Object.values(obj).forEach((v) => findEntries(v, out));
  }
  return out;
}

export function parseLumaPage(html: string): RawEvent[] {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  const seen = new Set<string>();
  const events: RawEvent[] = [];
  for (const { event, calendar, hosts } of findEntries(JSON.parse(m[1]), [])) {
    if (seen.has(event.api_id) || (event.visibility && event.visibility !== "public")) continue;
    seen.add(event.api_id);
    const timezone = event.timezone ?? "America/Los_Angeles";
    const geo = event.geo_address_info ?? {};
    const hostNames = (hosts ?? []).map((h) => h.name?.trim()).filter((n): n is string => !!n);
    const calendarName = calendar && !calendar.is_personal ? calendar.name : undefined;
    const online = event.location_type === "online";
    events.push({
      source: "luma",
      sourceId: event.api_id,
      title: event.name.trim(),
      description: [hostNames.length ? `Hosted by ${hostNames.join(", ")}.` : undefined, calendarName ? `Part of the ${calendarName} calendar on Luma.` : undefined]
        .filter(Boolean)
        .join(" "),
      url: `https://luma.com/${event.url}`,
      startsAt: toZonedIso(Date.parse(event.start_at), timezone),
      endsAt: event.end_at ? toZonedIso(Date.parse(event.end_at), timezone) : undefined,
      timezone,
      location: online
        ? { online: true }
        : {
            online: false,
            name: geo.address,
            address: geo.full_address ?? geo.short_address,
            city: geo.city,
            region: geo.region,
            country: geo.country,
            lat: event.coordinate?.latitude,
            lng: event.coordinate?.longitude,
          },
      organizer: calendarName ?? hostNames[0],
      hosts: hostNames,
      imageUrl: event.cover_url,
      organizerLogoUrl: calendar && !calendar.is_personal ? httpsUrl(calendar.avatar_url) : httpsUrl(hosts?.[0]?.avatar_url),
    });
  }
  return events;
}

export const lumaAdapter: Adapter = {
  source: "luma",
  fetch: async (feed, http) => parseLumaPage(await http.text(feed.url, "text/html")),
};
