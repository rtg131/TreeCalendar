import type { Adapter } from "../lib/adapter";
import { httpsUrl } from "../lib/media";
import type { RawEvent } from "../lib/rawEvent";
import { toZonedIso, zonedToUtc } from "../lib/time";

type DevpostHackathon = {
  id: number;
  title: string;
  url: string;
  displayed_location?: { icon?: string; location?: string };
  thumbnail_url?: string;
  submission_period_dates?: string;
  themes?: { name: string }[];
  prize_amount?: string;
  organization_name?: string;
  registrations_count?: number;
  invite_only?: boolean;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const TIMEZONE = "America/Los_Angeles";
const PAGE_TIMEZONE = "America/New_York";
const MAX_PAGES = 12;
const ONLINE_ONLY = /^(online|virtual|remote)$/i;
const HYBRID = /\+\s*online|\band online\b|\bhybrid\b/i;

const COUNTRIES: Record<string, string> = {
  usa: "US", us: "US", "united states": "US", "united states of america": "US",
  canada: "CA", uk: "GB", "united kingdom": "GB", england: "GB", scotland: "GB", wales: "GB",
  india: "IN", mexico: "MX", "méxico": "MX", germany: "DE", france: "FR", spain: "ES", italy: "IT",
  singapore: "SG", australia: "AU", japan: "JP", brazil: "BR", netherlands: "NL", ireland: "IE",
  pakistan: "PK", nigeria: "NG", kenya: "KE", slovakia: "SK", azerbaijan: "AZ", vietnam: "VN",
};

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "),
);

type JsonLdEvent = {
  "@type"?: string | string[];
  startDate?: string;
  endDate?: string;
  description?: string;
  eventAttendanceMode?: string;
  location?: {
    address?: {
      addressLocality?: string;
      addressRegion?: string;
      addressCountry?: string | { name?: string };
      streetAddress?: string;
    };
  };
};

type LocalDate = { year: number; month: number; day: number };

export function parseDevpostDates(text: string): { start: LocalDate; end: LocalDate } | undefined {
  const range = text.trim().match(/^([A-Za-z]{3}) (\d{1,2})(?:, (\d{4}))? - (?:([A-Za-z]{3}) )?(\d{1,2}), (\d{4})$/);
  if (range) {
    const startMonth = MONTHS.indexOf(range[1].toLowerCase());
    const endMonth = range[4] ? MONTHS.indexOf(range[4].toLowerCase()) : startMonth;
    if (startMonth < 0 || endMonth < 0) return undefined;
    const endYear = Number(range[6]);
    const startYear = range[3] ? Number(range[3]) : startMonth > endMonth ? endYear - 1 : endYear;
    return {
      start: { year: startYear, month: startMonth, day: Number(range[2]) },
      end: { year: endYear, month: endMonth, day: Number(range[5]) },
    };
  }
  const single = text.trim().match(/^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/);
  const month = single ? MONTHS.indexOf(single[1].toLowerCase()) : -1;
  if (!single || month < 0) return undefined;
  const date = { year: Number(single[3]), month, day: Number(single[2]) };
  return { start: date, end: date };
}

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "").trim();
const clean = (s: string | undefined) => s?.replace(/\s+/g, " ").trim().replace(/[.,]+$/, "").trim() || undefined;
const countryCode = (s: string | undefined) => (s ? (COUNTRIES[s.toLowerCase()] ?? s) : undefined);

export function parseDevpostLocation(text: string): { name?: string; city?: string; region?: string; country?: string } {
  const name = clean(text);
  const parts = (name ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  if (parts.length >= 2 && COUNTRIES[last.toLowerCase()]) {
    return { name, city: parts[0], region: parts.length > 2 ? parts[parts.length - 2] : undefined, country: countryCode(last) };
  }
  if (parts.length >= 2 && last.length === 2 && US_STATES.has(last.toUpperCase())) {
    return { name, city: parts[parts.length - 2], region: last.toUpperCase(), country: "US" };
  }
  return { name };
}

function findJsonLdEvent(html: string): JsonLdEvent | undefined {
  for (const [, body] of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
      const type = (node as JsonLdEvent | null)?.["@type"];
      const types = Array.isArray(type) ? type : [type];
      if (types.includes("Event") || types.includes("Hackathon")) return node as JsonLdEvent;
    }
  }
  return undefined;
}

/** Fills exact times and the street address from the hackathon's own page (schema.org Event JSON-LD). */
export function enrichFromHackathonPage(event: RawEvent, html: string): RawEvent {
  const ld = findJsonLdEvent(html);
  if (!ld) return event;
  if (ld.eventAttendanceMode?.endsWith("OnlineEventAttendanceMode")) return { ...event, location: { online: true } };
  const start = Date.parse(ld.startDate ?? "");
  const end = Date.parse(ld.endDate ?? "");
  const times =
    Number.isNaN(start) || Number.isNaN(end)
      ? {}
      : { startsAt: toZonedIso(start, PAGE_TIMEZONE), endsAt: toZonedIso(end, PAGE_TIMEZONE), timezone: PAGE_TIMEZONE };
  const address = ld.location?.address;
  const city = clean(address?.addressLocality);
  const street = clean(address?.streetAddress);
  const declared = typeof address?.addressCountry === "string" ? address.addressCountry : address?.addressCountry?.name;
  const location = city
    ? {
        online: false,
        name: event.location.name,
        address: street,
        city,
        region: clean(address?.addressRegion),
        country: countryCode(clean(declared) ?? clean(street?.split(",").pop())),
      }
    : event.location;
  const blurb = clean(ld.description);
  return { ...event, ...times, location, description: blurb ? event.description + " " + blurb : event.description };
}
const at = (d: LocalDate, hour: number, minute: number) =>
  toZonedIso(zonedToUtc(d.year, d.month, d.day, hour, minute, TIMEZONE), TIMEZONE);

export function parseDevpostPage(json: { hackathons?: DevpostHackathon[] }): RawEvent[] {
  const events: RawEvent[] = [];
  for (const h of json.hackathons ?? []) {
    if (h.invite_only) continue;
    const dates = h.submission_period_dates ? parseDevpostDates(h.submission_period_dates) : undefined;
    if (!dates) continue;
    const place = (h.displayed_location?.location ?? "Online").trim();
    const online = h.displayed_location?.icon === "globe" || ONLINE_ONLY.test(place);
    const mode = online ? "Online" : HYBRID.test(place) ? "Hybrid" : "In-person";
    const themes = (h.themes ?? []).map((t) => t.name);
    const prize = h.prize_amount ? stripHtml(h.prize_amount) : undefined;
    const description = [
      `${mode} hackathon${h.organization_name ? ` by ${h.organization_name}` : ""}.`,
      prize && prize !== "$0" ? `${prize} in prizes.` : undefined,
      themes.length ? `Themes: ${themes.join(", ")}.` : undefined,
      h.registrations_count ? `${h.registrations_count.toLocaleString("en-US")} registered.` : undefined,
    ]
      .filter(Boolean)
      .join(" ");
    events.push({
      source: "devpost",
      sourceId: String(h.id),
      title: h.title.trim(),
      description,
      url: h.url,
      startsAt: at(dates.start, 9, 0),
      endsAt: at(dates.end, 23, 59),
      timezone: TIMEZONE,
      location: online ? { online: true } : { online: false, ...parseDevpostLocation(place) },
      organizer: h.organization_name ?? undefined,
      imageUrl: h.thumbnail_url ? (h.thumbnail_url.startsWith("//") ? `https:${h.thumbnail_url}` : h.thumbnail_url) : undefined,
      organizerLogoUrl: httpsUrl(h.thumbnail_url),
      sourceTags: themes,
      sourceEventType: "hackathon",
    });
  }
  return events;
}

export const devpostAdapter: Adapter = {
  source: "devpost",
  async fetch(feed, http) {
    const inPersonFeed = new URL(feed.url).searchParams.getAll("challenge_type[]").includes("in-person");
    const byId = new Map<string, RawEvent>();
    let seen = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = new URL(feed.url);
      url.searchParams.set("page", String(page));
      const json = JSON.parse(await http.text(url.toString(), "application/json"));
      if (!json.hackathons?.length) break;
      parseDevpostPage(json).forEach((e) => byId.set(e.sourceId, e));
      seen += json.hackathons.length;
      if (json.meta?.total_count !== undefined && seen >= json.meta.total_count) break;
    }
    const events: RawEvent[] = [];
    for (const listed of byId.values()) {
      let event = listed;
      if (!listed.location.online) {
        try {
          event = enrichFromHackathonPage(listed, await http.text(listed.url, "text/html"));
        } catch {
          event = listed;
        }
      }
      if (inPersonFeed && event.location.online) continue;
      events.push(event);
    }
    return events;
  },
};
