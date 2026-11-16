import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import foundersVillage from "../fixtures/eventbrite/founders-village-32506722299.json";
import devpostPage from "../fixtures/devpost/in-person-page-1.json";
import lumaEventPage from "../fixtures/llm/pages/luma-startx-pitch-mixer.html?raw";
import jsonldLumaPage from "../fixtures/jsonld/luma/page.html?raw";
import meetupPage from "../fixtures/jsonld/meetup/page.html?raw";
import mlhHtml from "../fixtures/mlh/season-2027-events.html?raw";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { parseDevpostPage } from "./adapters/devpost";
import { parseEventbritePage, type EventbritePage } from "./adapters/eventbrite";
import { parseEventPage } from "./adapters/jsonld";
import { parseLumaPage } from "./adapters/luma";
import { parseMlhSeasonPage } from "./adapters/mlh";
import type { RawEvent } from "./lib/rawEvent";
import { normalize, type NormalizedEvent } from "./normalize";
import { mergeEvents, pickEvent } from "./normalize/dedupe";
import { pageMedia } from "./normalize/enrich";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

const LUMA_URL = "https://luma.com/wt2t02x4";
const LUMA_CALENDAR_AVATAR = "https://images.lumacdn.com/calendars/57/97f8caa9-3e9b-46fd-8858-5f0d6054769d.png";
const LUMA_HOST_AVATAR = "https://images.lumacdn.com/avatars/bh/a56846ee-aa90-4f34-b328-300c94ce0578.png";
const LUMA_COVER = "https://images.lumacdn.com/gallery-images/6v/8eb55214-a49e-4cae-ad8a-9187371c15cd.png";
const MEETUP_URL = "https://www.meetup.com/noisebridge/events/cqwfbvyjcqbsb/";
const MEETUP_BANNER = "https://secure.meetupstatic.com/photos/event/d/2/e/5/600_535313989.jpeg";
const DAY = 86_400_000;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("adapter logo mapping", () => {
  test("luma uses the calendar avatar for a non-personal calendar and the first host's otherwise", () => {
    const [event] = parseLumaPage(lumaEventPage);
    expect(event).toMatchObject({ url: LUMA_URL, imageUrl: LUMA_COVER, organizerLogoUrl: LUMA_CALENDAR_AVATAR });
    const personal = lumaEventPage.replace('"is_personal":false', '"is_personal":true');
    expect(parseLumaPage(personal)[0].organizerLogoUrl).toBe(LUMA_HOST_AVATAR);
    const insecure = personal.replaceAll(LUMA_HOST_AVATAR, LUMA_HOST_AVATAR.replace("https:", "http:"));
    expect(parseLumaPage(insecure)[0].organizerLogoUrl).toBeUndefined();
  });

  test("eventbrite maps organizer.logo.url and keeps the event logo as the banner", () => {
    const page = structuredClone(foundersVillage) as unknown as EventbritePage & { events: { organizer: Record<string, unknown> }[] };
    page.events[0].organizer.logo = { url: "https://img.evbuc.com/organizer-logo.png" };
    const [event] = parseEventbritePage(page);
    expect(event.organizerLogoUrl).toBe("https://img.evbuc.com/organizer-logo.png");
    expect(event.imageUrl).toMatch(/^https:\/\/img\.evbuc\.com\//);
    page.events[0].organizer.logo = { url: "http://img.evbuc.com/organizer-logo.png" };
    expect(parseEventbritePage(page)[0].organizerLogoUrl).toBeUndefined();
  });

  test("mlh maps logoUrl to the logo and keeps backgroundUrl ?? logoUrl as the banner", () => {
    const events = parseMlhSeasonPage(mlhHtml);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.organizerLogoUrl).toMatch(/^https:\/\/mlhusercontent\.com\/logos\//);
      expect(e.imageUrl).toBeTruthy();
    }
  });

  test("devpost uses the square thumbnail as the logo, with https", () => {
    const events = parseDevpostPage(devpostPage);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.organizerLogoUrl).toMatch(/^https:\/\//);
      expect(e.organizerLogoUrl).toBe(e.imageUrl);
    }
  });

  test("jsonld reads organizer.logo or organizer.image from an Organization or Person", () => {
    const [luma] = parseEventPage(jsonldLumaPage, "https://luma.com/demo-night-dec2026");
    expect(luma.organizerLogoUrl).toBe("https://images.lumacdn.com/calendars/xz/a7cb4c75-9cbd-4853-8012-496c5ef3eb77.png");
    const page = (organizer: unknown) =>
      '<script type="application/ld+json">' +
      JSON.stringify({ "@type": "Event", name: "Demo", startDate: "2026-12-01T18:00:00-08:00", location: "SF", organizer }) +
      "</script>";
    const logo = (organizer: unknown) => parseEventPage(page(organizer), "https://example.org/e")[0].organizerLogoUrl;
    expect(logo({ "@type": "Organization", name: "A", logo: { "@type": "ImageObject", url: "https://cdn.example/a.png" } })).toBe("https://cdn.example/a.png");
    expect(logo({ "@type": "Person", name: "B", image: ["https://cdn.example/b.png"] })).toBe("https://cdn.example/b.png");
    expect(logo([{ "@type": "Place", name: "C", image: "https://cdn.example/c.png" }, { "@type": "Organization", name: "D", logo: "/d.png" }])).toBe("https://example.org/d.png");
    expect(logo({ "@type": "Organization", name: "E", logo: "http://cdn.example/e.png" })).toBeUndefined();
    expect(logo("Just a name")).toBeUndefined();
  });
});

describe("pickEvent and merges carry organizerLogoUrl", () => {
  const base = async (o: Partial<RawEvent> = {}) =>
    (await normalize({
      source: "fixture", sourceId: "x", title: "Founders demo night", description: "Startup founders pitch to investors.",
      url: "https://example.org/x", startsAt: "2026-12-07T17:30:00-08:00", timezone: "America/Los_Angeles",
      location: { online: false, address: "Hacker Dojo, Mountain View", city: "Mountain View" }, ...o,
    }))!;

  test("pickEvent keeps the field and mergeEvents prefers the primary's", async () => {
    const withLogo = await base({ organizerLogoUrl: "https://cdn.example/p.png", imageUrl: "https://cdn.example/p-banner.png" });
    expect(pickEvent({ ...withLogo, extra: 1 } as NormalizedEvent)).toMatchObject({ organizerLogoUrl: "https://cdn.example/p.png" });
    const bare = await base({ source: "other", sourceId: "y" });
    expect(mergeEvents(bare, withLogo)).toMatchObject({ organizerLogoUrl: "https://cdn.example/p.png", imageUrl: "https://cdn.example/p-banner.png" });
    const other = await base({ organizerLogoUrl: "https://cdn.example/o.png" });
    expect(mergeEvents(withLogo, other).organizerLogoUrl).toBe("https://cdn.example/p.png");
  });

  test("normalize drops a non-https logo", async () => {
    expect((await base({ organizerLogoUrl: "http://cdn.example/p.png" })).organizerLogoUrl).toBeUndefined();
  });
});

function stub(pages: Record<string, string>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (pages[url] !== undefined) return new Response(pages[url]);
      return new Response("not found", { status: 404 });
    }),
  );
  return calls;
}

const row = (sourceId: string, url: string, o: Record<string, unknown> = {}) => ({
  source: "ical", sourceId, title: "Pitch mixer " + sourceId, description: "Founders pitch.", startTime: Date.now() + DAY,
  timezone: "America/Los_Angeles", city: "San Francisco", address: "1 Market St, San Francisco", isOnline: false, url,
  hosts: [], tags: [], eventType: "networking" as const, audience: ["founders" as const], investorScore: 0, investorSignals: [], lastSeenAt: 0, ...o,
});

const scheduled = async (t: ReturnType<typeof convexTest>, name: string) =>
  (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((f) => f.name.includes(name));

describe("media enrichment", () => {
  test("pageMedia reads the Luma cover and calendar avatar, and the Meetup og:image", () => {
    expect(pageMedia(lumaEventPage, LUMA_URL)).toEqual({ imageUrl: LUMA_COVER, organizerLogoUrl: LUMA_CALENDAR_AVATAR });
    expect(pageMedia(lumaEventPage, "https://lu.ma/wt2t02x4").organizerLogoUrl).toBe(LUMA_CALENDAR_AVATAR);
    expect(pageMedia(meetupPage, MEETUP_URL)).toEqual({ imageUrl: MEETUP_BANNER });
  });

  test("an event that has a place but no banner or logo is enriched once, cached, and kept on re-crawl", async () => {
    const FEED = "https://fixtures.test/feed.json";
    const raws: RawEvent[] = [
      { source: "fixture", sourceId: "luma", title: "StartX pitch mixer", description: "Startup founders pitch to investors.", url: LUMA_URL, startsAt: "2026-12-07T17:30:00-08:00", timezone: "America/Los_Angeles", location: { online: false, address: "1 Market St, San Francisco", city: "San Francisco" } },
      { source: "fixture", sourceId: "meetup", title: "Noisebridge founders night", description: "Startup founders pitch to investors.", url: MEETUP_URL, startsAt: "2026-12-08T17:30:00-08:00", timezone: "America/Los_Angeles", location: { online: false, address: "272 Capp St, San Francisco", city: "San Francisco" } },
    ];
    const calls = stub({ [FEED]: JSON.stringify(raws), [LUMA_URL]: lumaEventPage, [MEETUP_URL]: meetupPage });
    const t = convexTest(schema, modules);
    const feedId = await t.run((ctx) => ctx.db.insert("feeds", { source: "fixture", name: "fixture", url: FEED, enabled: true, intervalMinutes: 60 }));
    await t.action(internal.ingest.runFeed, { feedId });
    const jobs = await scheduled(t, "enrich");
    expect(jobs).toHaveLength(1);
    while ((await scheduled(t, "enrich")).some((f) => f.state.kind === "pending" || f.state.kind === "inProgress")) await new Promise((r) => setTimeout(r, 50));
    expect((await scheduled(t, "enrich"))[0].state.kind).toBe("success");

    const events = async () => new Map((await t.run((ctx) => ctx.db.query("events").collect())).map((e) => [e.sourceId, e]));
    expect((await events()).get("luma")).toMatchObject({ imageUrl: LUMA_COVER, organizerLogoUrl: LUMA_CALENDAR_AVATAR, address: "1 Market St, San Francisco" });
    expect((await events()).get("meetup")).toMatchObject({ imageUrl: MEETUP_BANNER });
    const pages = await t.run((ctx) => ctx.db.query("event_pages").collect());
    expect(pages.every((p) => p.mediaChecked)).toBe(true);
    expect(pages.find((p) => p.url === LUMA_URL)).toMatchObject({ imageUrl: LUMA_COVER, organizerLogoUrl: LUMA_CALENDAR_AVATAR });

    const pageFetches = () => calls.filter((c) => c === LUMA_URL || c === MEETUP_URL).length;
    expect(pageFetches()).toBe(2);
    await t.action(internal.ingest.runFeed, { feedId });
    expect(pageFetches()).toBe(2);
    expect(await scheduled(t, "enrich")).toHaveLength(1);
    expect((await events()).get("luma")).toMatchObject({ imageUrl: LUMA_COVER, organizerLogoUrl: LUMA_CALENDAR_AVATAR });
  }, 30_000);

  test("a page cached before media extraction is fetched again for an event missing media", async () => {
    stub({ [LUMA_URL]: lumaEventPage });
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("event_pages", { url: LUMA_URL, status: "found", place: { city: "San Francisco", address: "1 Market St, San Francisco" }, fetchedAt: Date.now() });
      await ctx.db.insert("events", row("old", LUMA_URL));
    });
    expect(await t.action(internal.normalize.enrich.run, { targets: [{ url: LUMA_URL, source: "ical", sourceId: "old" }] })).toMatchObject({ fetched: 1, media: 1 });
    expect(await t.run((ctx) => ctx.db.query("event_pages").collect())).toHaveLength(1);
  }, 15_000);
});

describe("media backfill", () => {
  test("pages through upcoming events, re-schedules itself, respects the fetch cap and reports coverage", async () => {
    const urls = ["a", "b", "c", "d"].map((id) => "https://luma.com/e-" + id);
    stub(Object.fromEntries(urls.map((u) => [u, lumaEventPage])));
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const [i, url] of urls.entries()) await ctx.db.insert("events", row(String(i), url));
      await ctx.db.insert("events", row("done", "https://luma.com/done", { imageUrl: "https://cdn.example/x.png", organizerLogoUrl: "https://cdn.example/y.png" }));
      await ctx.db.insert("events", row("elsewhere", "https://example.org/e"));
      await ctx.db.insert("events", row("hidden", "https://luma.com/hidden", { hiddenAt: 1 }));
      await ctx.db.insert("events", row("past", "https://luma.com/past", { startTime: Date.now() - 2 * DAY }));
    });
    const before = await t.query(internal.normalize.enrich.mediaCoverage, {});
    expect(before.total).toEqual({ events: 6, banner: 1, logo: 1 });

    const first = await t.action(internal.normalize.enrich.backfillMedia, { numItems: 3, maxFetches: 1 });
    expect(first).toMatchObject({ scanned: 3, fetched: 1, isDone: false });
    expect(first.deferred).toBeGreaterThan(0);
    while ((await scheduled(t, "backfillMedia")).some((f) => f.state.kind === "pending" || f.state.kind === "inProgress")) await new Promise((r) => setTimeout(r, 50));
    const jobs = await scheduled(t, "backfillMedia");
    expect(jobs.length).toBeGreaterThanOrEqual(4);
    expect(jobs.every((f) => f.state.kind === "success")).toBe(true);
    expect((jobs[0].args[0] as { cursor: string | null }).cursor).toBeNull();
    expect(jobs.some((f) => typeof (f.args[0] as { cursor: string | null }).cursor === "string")).toBe(true);

    const after = await t.query(internal.normalize.enrich.mediaCoverage, {});
    expect(after.total).toEqual({ events: 6, banner: 5, logo: 5 });
    expect(after.bySource.ical).toEqual(after.total);
    const fetched = await t.run((ctx) => ctx.db.query("event_pages").collect());
    expect(fetched.map((p) => p.url).sort()).toEqual(urls);
  }, 60_000);

  test("recrawl schedules the enabled feeds of the logo sources", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("feeds", { source: "luma", name: "Luma on", url: "https://luma.com/sf", enabled: true, intervalMinutes: 60 });
      await ctx.db.insert("feeds", { source: "mlh", name: "MLH off", url: "https://www.mlh.com/seasons/2027/events", enabled: false, intervalMinutes: 60 });
      await ctx.db.insert("feeds", { source: "ical", name: "iCal", url: "https://example.org/cal.ics", enabled: true, intervalMinutes: 60 });
    });
    expect(await t.mutation(internal.ingest.recrawl, {})).toEqual(["Luma on"]);
  });
});

describe("hostCompany", () => {
  async function setup() {
    const t = convexTest(schema, modules);
    await t.mutation(api.users.upsert, { deviceId: "d", role: "student", interests: [], city: "San Francisco", lat: 37.77, lng: -122.42, locationSource: "city" });
    const ids = await t.run(async (ctx) => {
      const userId = (await ctx.db.query("users").first())!._id;
      const company = (name: string, verified: boolean, logo?: string) =>
        ctx.db.insert("companies", { name, slug: name.toLowerCase(), createdAt: 0, ...(verified ? { verifiedAt: 1 } : {}), ...(logo ? { logo } : {}) });
      const verified = await company("Acme", true, "https://cdn.example/acme.png");
      const unverified = await company("Shady", false);
      const event = (id: string) => ctx.db.insert("events", { ...row(id, "https://example.org/" + id), lat: 37.77, lng: -122.42 });
      const approved = await event("approved");
      const pending = await event("pending");
      const unverifiedEvent = await event("unverified");
      const none = await event("none");
      const claim = (eventId: Id<"events">, companyId: Id<"companies">, status: "approved" | "pending", createdAt = 0) =>
        ctx.db.insert("event_hosts", { eventId, companyId, claimedBy: userId, status, createdAt });
      await claim(approved, unverified, "approved", 0);
      await claim(approved, verified, "approved", 1);
      await claim(pending, verified, "pending");
      await claim(unverifiedEvent, unverified, "approved");
      for (const eventId of [approved, pending, unverifiedEvent, none]) {
        await ctx.db.insert("saves", { userId, eventId, savedAt: 0 });
        await ctx.db.insert("attendance", { userId, eventId, going: true, attended: true });
      }
      return { approved, pending, unverifiedEvent, none, verified };
    });
    return { t, ids };
  }

  test("only approved claims by verified companies appear, on feed, saves, history and events.host", async () => {
    const { t, ids } = await setup();
    const acme = { _id: ids.verified, name: "Acme", logo: "https://cdn.example/acme.png" };
    const byId = (rows: { _id: Id<"events">; hostCompany?: unknown }[]) => new Map(rows.map((r) => [r._id, r.hostCompany]));
    const expectHosts = (hosts: Map<Id<"events">, unknown>) => {
      expect(hosts.size).toBe(4);
      expect(hosts.get(ids.approved)).toEqual(acme);
      for (const id of [ids.pending, ids.unverifiedEvent, ids.none]) expect(hosts.get(id)).toBeUndefined();
    };
    const feed = await t.query(api.feed.ranked, { deviceId: "d" });
    expectHosts(byId(feed!.events));
    expectHosts(byId(await t.query(api.saves.list, { deviceId: "d" })));
    expectHosts(byId((await t.query(api.attendance.history, { deviceId: "d" })).map((r) => r.event)));
    expect(await t.query(api.events.host, { eventId: ids.approved })).toEqual(acme);
    expect(await t.query(api.events.host, { eventId: ids.pending })).toBeNull();
    expect(await t.query(api.events.host, { eventId: ids.unverifiedEvent })).toBeNull();
  });

  test("feed rows carry organizerLogoUrl", async () => {
    const { t, ids } = await setup();
    await t.run((ctx) => ctx.db.patch(ids.none, { organizerLogoUrl: "https://cdn.example/org.png" }));
    const feed = await t.query(api.feed.ranked, { deviceId: "d" });
    expect(feed?.events.find((e) => e._id === ids.none)?.organizerLogoUrl).toBe("https://cdn.example/org.png");
  });
});
