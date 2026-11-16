import type { Adapter } from "../lib/adapter";
import { httpsUrl } from "../lib/media";
import type { RawEvent } from "../lib/rawEvent";
import { toZonedIso } from "../lib/time";

type MlhEvent = {
  id: string;
  name: string;
  startsAt?: string | null;
  endsAt?: string | null;
  url?: string | null;
  location?: string | null;
  formatType?: string | null;
  websiteUrl?: string | null;
  backgroundUrl?: string | null;
  logoUrl?: string | null;
  organizationName?: string | null;
  customFields?: { hackathon_focus?: string[] | null } | null;
  venueAddress?: { city?: string | null; state?: string | null; country?: string | null } | null;
};

const MLH_ORIGIN = "https://www.mlh.com";

const clean = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() || undefined;

function withoutTracking(raw: string): string {
  const url = new URL(raw);
  for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_")) url.searchParams.delete(key);
  return url.toString();
}

export function parseMlhSeasonPage(html: string): RawEvent[] {
  const match = html.match(/<script[^>]*data-page="app"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("MLH season page: Inertia data-page script not found");
  const events = (JSON.parse(match[1]) as { props?: { upcomingEvents?: MlhEvent[] } }).props?.upcomingEvents;
  if (!Array.isArray(events)) throw new Error("MLH season page: props.upcomingEvents missing");

  return events.flatMap((event): RawEvent[] => {
    const format = event.formatType ?? "";
    const hybrid = format.startsWith("hybrid");
    if (format !== "physical" && !hybrid) return [];
    const start = Date.parse(event.startsAt ?? "");
    const end = Date.parse(event.endsAt ?? "");
    if (Number.isNaN(start) || Number.isNaN(end)) return [];
    const city = clean(event.venueAddress?.city);
    const region = clean(event.venueAddress?.state);
    const website = clean(event.websiteUrl);
    const place = [city, region].filter(Boolean).join(", ");
    return [
      {
        source: "mlh",
        sourceId: event.id,
        title: event.name.trim(),
        description: (hybrid ? "Hybrid" : "In-person") + " MLH member hackathon" + (place ? " in " + place : "") + ".",
        url: website ? withoutTracking(website) : new URL(event.url ?? "/seasons", MLH_ORIGIN).toString(),
        startsAt: toZonedIso(start, "UTC"),
        endsAt: toZonedIso(end, "UTC"),
        timezone: "UTC",
        location: {
          online: false,
          name: clean(event.location),
          city,
          region,
          country: clean(event.venueAddress?.country),
        },
        organizer: clean(event.organizationName),
        imageUrl: clean(event.backgroundUrl) ?? clean(event.logoUrl),
        organizerLogoUrl: httpsUrl(event.logoUrl),
        sourceTags: event.customFields?.hackathon_focus ?? [],
        sourceEventType: "hackathon",
      },
    ];
  });
}

export const mlhAdapter: Adapter = {
  source: "mlh",
  async fetch(feed, http) {
    return parseMlhSeasonPage(await http.text(feed.url, "text/html"));
  },
};
