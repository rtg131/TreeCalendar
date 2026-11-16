import type { Adapter } from "../lib/adapter";
import { httpsUrl } from "../lib/media";
import type { RawEvent } from "../lib/rawEvent";
import { toZonedIso } from "../lib/time";

const API = "https://www.eventbriteapi.com/v3";
const MAX_PAGES = 10;

type EventbriteTime = { timezone: string; utc: string };

type EventbriteEvent = {
  id: string;
  name: { text: string | null };
  description?: { text?: string | null } | null;
  summary?: string | null;
  url: string;
  start: EventbriteTime;
  end?: EventbriteTime | null;
  status?: string;
  listed?: boolean;
  invite_only?: boolean;
  online_event?: boolean;
  logo?: { url?: string | null; original?: { url?: string | null } | null } | null;
  organizer?: { name?: string | null; logo?: { url?: string | null } | null } | null;
  venue?: {
    name?: string | null;
    latitude?: string | null;
    longitude?: string | null;
    address?: {
      city?: string | null;
      region?: string | null;
      country?: string | null;
      localized_address_display?: string | null;
    } | null;
  } | null;
};

export type EventbritePage = {
  events?: EventbriteEvent[];
  pagination?: { has_more_items?: boolean; continuation?: string };
};

export class MissingEventbriteTokenError extends Error {
  constructor() {
    super("EVENTBRITE_TOKEN is not set on this deployment, so Eventbrite feeds cannot run");
    this.name = "MissingEventbriteTokenError";
  }
}

export function organizerId(feedUrl: string): string {
  const match = new URL(feedUrl).pathname.match(/^\/o\/(?:.*-)?(\d+)\/?$/);
  if (!match) throw new Error(`${feedUrl} is not an Eventbrite organizer URL (https://www.eventbrite.com/o/<slug>-<id>)`);
  return match[1];
}

export function organizerEventsUrl(id: string, continuation?: string): string {
  const url = new URL(`${API}/organizers/${id}/events/`);
  url.searchParams.set("status", "live");
  url.searchParams.set("expand", "venue,organizer,organizer.logo");
  if (continuation) url.searchParams.set("continuation", continuation);
  return url.toString();
}

const text = (value: string | null | undefined) => value?.trim() || undefined;
const coordinate = (value: string | null | undefined) => {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

export function parseEventbritePage(page: EventbritePage): RawEvent[] {
  const events: RawEvent[] = [];
  for (const event of page.events ?? []) {
    const title = text(event.name.text);
    if (!title || event.online_event || event.listed === false || event.invite_only) continue;
    if (event.status && event.status !== "live") continue;
    const timezone = event.start.timezone;
    const venue = event.venue ?? {};
    const address = venue.address ?? {};
    events.push({
      source: "eventbrite",
      sourceId: event.id,
      title,
      description: text(event.description?.text) ?? text(event.summary) ?? "",
      url: event.url,
      startsAt: toZonedIso(Date.parse(event.start.utc), timezone),
      endsAt: event.end ? toZonedIso(Date.parse(event.end.utc), event.end.timezone) : undefined,
      timezone,
      location: {
        online: false,
        name: text(venue.name),
        address: text(address.localized_address_display),
        city: text(address.city),
        region: text(address.region),
        country: text(address.country),
        lat: coordinate(venue.latitude),
        lng: coordinate(venue.longitude),
      },
      organizer: text(event.organizer?.name),
      imageUrl: text(event.logo?.original?.url) ?? text(event.logo?.url),
      organizerLogoUrl: httpsUrl(event.organizer?.logo?.url),
    });
  }
  return events;
}

export const eventbriteAdapter: Adapter = {
  source: "eventbrite",
  async fetch(feed, http) {
    const token = process.env.EVENTBRITE_TOKEN;
    if (!token) throw new MissingEventbriteTokenError();
    const id = organizerId(feed.url);
    const headers = { Authorization: `Bearer ${token}` };
    const seen = new Set<string>();
    const events: RawEvent[] = [];
    let continuation: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = JSON.parse(await http.text(organizerEventsUrl(id, continuation), "application/json", headers)) as EventbritePage;
      for (const event of parseEventbritePage(body)) {
        if (seen.has(event.sourceId)) continue;
        seen.add(event.sourceId);
        events.push(event);
      }
      continuation = body.pagination?.has_more_items ? body.pagination.continuation : undefined;
      if (!continuation) break;
    }
    return events;
  },
};
