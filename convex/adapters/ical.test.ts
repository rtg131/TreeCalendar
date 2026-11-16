import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { RawEvent } from "../lib/rawEvent";
import schema from "../schema";
import googleExpected from "../../fixtures/ical/google-public.expected.json";
import googleIcs from "../../fixtures/ical/google-public.ics?raw";
import localistExpected from "../../fixtures/ical/localist-stanford.expected.json";
import localistIcs from "../../fixtures/ical/localist-stanford.ics?raw";
import lumaExpected from "../../fixtures/ical/luma-openrouter.expected.json";
import lumaIcs from "../../fixtures/ical/luma-openrouter.ics?raw";
import venuesExpected from "../../fixtures/ical/venues.expected.json";
import venuesIcs from "../../fixtures/ical/venues.ics?raw";
import { icalAdapter, parseIcal, venueOf } from "./ical";

const modules = import.meta.glob(["../**/*.ts", "../**/*.js", "!../**/*.test.ts", "!../**/*.d.ts"]);

const NOW = new Date("2026-11-15T19:00:00Z");
const GOOGLE_URL = "https://calendar.google.com/calendar/ical/bay-area-builders/public/basic.ics";
const parseGoogle = (now = NOW) => parseIcal(googleIcs, { source: "ical", feedUrl: GOOGLE_URL, now });

const platforms: { name: string; url: string; ics: string; expected: RawEvent[] }[] = [
  { name: "Localist (Stanford University)", url: "https://events.stanford.edu/calendar.ics", ics: localistIcs, expected: localistExpected },
  { name: "Luma calendar (OpenRouter Events)", url: "https://api.lu.ma/ics/get?entity=calendar&id=cal-cv816PW6bxfYMVP", ics: lumaIcs, expected: lumaExpected },
  { name: "public Google Calendar", url: GOOGLE_URL, ics: googleIcs, expected: googleExpected },
];

describe("ical adapter", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const platform of platforms) {
    it(`parses the ${platform.name} fixture`, async () => {
      const requested: [string, string | undefined][] = [];
      const http = { text: async (url: string, accept?: string) => (requested.push([url, accept]), platform.ics) };
      const events = await icalAdapter.fetch({ source: "ical", name: platform.name, url: platform.url }, http);
      expect(requested).toEqual([[platform.url, "text/calendar"]]);
      expect(events).toEqual(platform.expected);
    });
  }

  it("derives venue from the first LOCATION segment unless it is an address or a city", () => {
    const events = parseIcal(venuesIcs, { source: "ical", feedUrl: "https://example.org/venues.ics", now: NOW });
    expect(events).toEqual(venuesExpected);
    expect(events.map((e) => e.location.name)).toEqual([
      "Frontier Tower",
      undefined,
      undefined,
      undefined,
      "Hohbach Hall",
      "Mission Bay Conference Center",
      undefined,
      undefined,
    ]);
    expect(events.every((e) => e.location.address)).toBe(true);
    expect(venueOf("Stanford d.school, 416 Escondido Mall, Stanford, CA 94305, USA")).toBe("Stanford d.school");
    expect(venueOf("Berkeley, CA 94720")).toBeUndefined();
  });

  it("emits events that pass the RawEvent validator", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.ingest.ensureFeeds, {});
    const feedId = (await t.run((ctx) => ctx.db.query("feeds").first()))!._id;
    const items = platforms.flatMap((p) => p.expected).map((raw) => ({ raw, event: null }));
    await t.mutation(internal.ingest.store, { feedId, items });
    expect(await t.run(async (ctx) => (await ctx.db.query("raw_listings").collect()).length)).toBe(items.length);
  });

  it("expands recurrences only through the next 60 days", () => {
    const buildNights = (events: RawEvent[]) => events.filter((e) => e.sourceId.startsWith("weekly-build-night@")).map((e) => e.startsAt);
    expect(buildNights(parseGoogle()).map((s) => s.slice(0, 10))).toEqual([
      "2026-11-17",
      "2026-12-01",
      "2026-12-08",
      "2026-12-15",
      "2026-12-22",
      "2027-01-05",
      "2027-01-12",
    ]);
    expect(buildNights(parseGoogle(new Date("2026-12-20T00:00:00Z"))).at(-1)).toBe("2027-02-16T18:30:00-08:00");
  });

  it("skips private, confidential and cancelled events", () => {
    const titles = parseGoogle().map((e) => e.title);
    expect(titles).not.toContain("Organizer standup");
    expect(titles).not.toContain("Sponsor call");
    expect(titles).not.toContain("Cancelled Talk");
  });

  it("rejects a response that is not an iCalendar document", () => {
    expect(() => parseIcal('{"message":"Group not found"}', { source: "ical", feedUrl: GOOGLE_URL, now: NOW })).toThrow("not an iCalendar");
  });
});

describe("ical location text", () => {
  const vevent = (location: string) =>
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:loc-test",
      "DTSTART:20261120T020000Z",
      "DTEND:20261120T040000Z",
      "SUMMARY:Founder pitch night",
      `LOCATION:${location}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
  const locationOf = (text: string) => parseIcal(vevent(text), { source: "ical", feedUrl: "https://example.com/cal.ics", now: NOW })[0].location;

  it("treats meeting-room words as online", () => {
    for (const text of ["Zoom", "Virtual", "Online event", "Zoom Webinar"]) expect(locationOf(text)).toEqual({ online: true });
  });

  it("drops placeholder text instead of geocoding it", () => {
    for (const text of ["Sign in to download the location", "Detailed agenda and location will be shared directly with selected applicants", "TBA"]) {
      expect(locationOf(text)).toEqual({ online: false });
    }
  });

  it("keeps real venues", () => {
    expect(locationOf("Evans 597")).toEqual({ online: false, address: "Evans 597", name: "Evans 597" });
    expect(locationOf("Zoomcar HQ, Palo Alto")).toEqual({ online: false, address: "Zoomcar HQ, Palo Alto", name: "Zoomcar HQ" });
  });
});
