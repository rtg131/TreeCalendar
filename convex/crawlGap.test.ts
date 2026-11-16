import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { RawEvent } from "./lib/rawEvent";
import schema from "./schema";
import lumaPage from "../fixtures/jsonld/luma/page.html?raw";
import meetupPage from "../fixtures/jsonld/meetup/page.html?raw";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

const FEED_URL = "https://fixtures.test/events.json";
const LUMA_URL = "https://luma.com/demo-night-dec2026";
const MEETUP_URL = "https://www.meetup.com/noisebridge/events/cqwfbvyjcqbsb/";
const NYC_URL = "https://luma.com/nyc-founders-mixer";
const NYC_PAGE = '<html><head><script type="application/ld+json">' +
  JSON.stringify({ "@context": "https://schema.org", "@type": "Event", name: "NYC Founders Mixer", startDate: "2026-12-09T18:00:00-05:00", url: NYC_URL, location: { "@type": "Place", name: "Betaworks", address: "29 Little West 12th St, New York, NY", geo: { latitude: 40.7397, longitude: -74.0079 } } }) +
  "</script></head></html>";
const ONLINE_URL = "https://luma.com/online-roundtable";
const ONLINE_PAGE = '<html><head><script type="application/ld+json">' +
  JSON.stringify({ "@context": "https://schema.org", "@type": "Event", name: "Online roundtable", startDate: "2026-12-14T12:00:00-06:00", eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode", location: { "@type": "VirtualLocation", url: ONLINE_URL } }) +
  "</script></head></html>";

const raw = (sourceId: string, url: string, o: Partial<RawEvent> = {}): RawEvent => ({
  source: "fixture",
  sourceId,
  title: "Founders demo night " + sourceId,
  description: "Startup founders pitch to investors.",
  url,
  startsAt: "2026-12-07T17:30:00-08:00",
  timezone: "America/Los_Angeles",
  location: { online: false },
  ...o,
});

function stub(pages: Record<string, string>, feed: () => RawEvent[]) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (url === FEED_URL) return new Response(JSON.stringify(feed()));
      if (pages[url] !== undefined) return new Response(pages[url]);
      return new Response("not found", { status: 404 });
    }),
  );
  return calls;
}

const scheduledEnrich = async (t: ReturnType<typeof convexTest>) =>
  (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((f) => f.name.includes("enrich"));

const eventBy = async (t: ReturnType<typeof convexTest>, sourceId: string) =>
  (await t.run((ctx) => ctx.db.query("events").collect())).find((e) => e.sourceId === sourceId)!;

async function settled(t: ReturnType<typeof convexTest>) {
  while ((await scheduledEnrich(t)).some((f) => f.state.kind === "pending" || f.state.kind === "inProgress")) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("location enrichment", () => {
  test("fills location from the Luma or Meetup event page once, and re-crawls reuse the cache", async () => {
    const items = [raw("luma", LUMA_URL), raw("meetup", MEETUP_URL), raw("nyc", NYC_URL), raw("other", "https://example.org/e/1"), raw("online", ONLINE_URL), raw("placed", "https://luma.com/has-address", { location: { online: false, address: "Hacker Dojo, Mountain View" }, imageUrl: "https://images.example/cover.png", organizerLogoUrl: "https://images.example/logo.png" })];
    const calls = stub({ [LUMA_URL]: lumaPage, [MEETUP_URL]: meetupPage, [NYC_URL]: NYC_PAGE, [ONLINE_URL]: ONLINE_PAGE }, () => items);
    const t = convexTest(schema, modules);
    const feedId = await t.run((ctx) => ctx.db.insert("feeds", { source: "fixture", name: "fixture", url: FEED_URL, enabled: true, intervalMinutes: 60 }));

    await t.action(internal.ingest.runFeed, { feedId });
    const [job] = await scheduledEnrich(t);
    expect((job.args[0] as { targets: { url: string }[] }).targets.map((x) => x.url)).toEqual([LUMA_URL, MEETUP_URL, NYC_URL, ONLINE_URL]);
    await settled(t);

    expect(await eventBy(t, "luma")).toMatchObject({ venue: "WorkOS", city: "San Francisco", lat: 37.788385399999996 });
    expect(await eventBy(t, "meetup")).toMatchObject({ venue: "Noisebridge", city: "San Francisco", address: "272 Capp St, Noisebridge, San Francisco, CA, US" });
    expect((await eventBy(t, "meetup")).lat).toBeDefined();
    expect((await eventBy(t, "nyc")).hiddenAt).toBeDefined();
    expect((await eventBy(t, "other")).lat).toBeUndefined();
    expect(await eventBy(t, "online")).toMatchObject({ isOnline: true, city: "Online" });
    expect((await eventBy(t, "luma")).hiddenAt).toBeUndefined();

    const pageFetches = () => calls.filter((c) => [LUMA_URL, MEETUP_URL, NYC_URL, ONLINE_URL].includes(c)).length;
    expect(pageFetches()).toBe(4);
    await t.action(internal.ingest.runFeed, { feedId });
    expect(pageFetches()).toBe(4);
    expect(await eventBy(t, "online")).toMatchObject({ isOnline: true, city: "Online" });
    expect(await scheduledEnrich(t)).toHaveLength(1);
    expect(await eventBy(t, "luma")).toMatchObject({ venue: "WorkOS", lat: 37.788385399999996 });
    expect((await eventBy(t, "nyc")).hiddenAt).toBeDefined();
  }, 30_000);

  test("caps page fetches per run and leaves the rest for the next run", async () => {
    stub({}, () => []);
    const t = convexTest(schema, modules);
    const targets = ["a", "b", "c"].map((id) => ({ url: "https://www.meetup.com/g/events/" + id + "/", source: "fixture", sourceId: id }));
    expect(await t.action(internal.normalize.enrich.run, { targets, maxFetches: 2 })).toEqual({ fetched: 2, placed: 0, dropped: 0, media: 0, deferred: 1 });
    expect((await t.run((ctx) => ctx.db.query("event_pages").collect())).map((p) => p.status)).toEqual(["error", "error"]);
  }, 15_000);
});

describe("stale rows", () => {
  test("an event a feed stops returning is hidden, not deleted, and comes back when it reappears", async () => {
    const a = raw("a", "https://example.org/a", { location: { online: false, address: "Hacker Dojo, Mountain View" } });
    const b = raw("b", "https://example.org/b", { title: "Pitch night b", startsAt: "2026-12-08T18:00:00-08:00", location: { online: false, address: "Hacker Dojo, Mountain View" } });
    let items = [a, b];
    stub({}, () => items);
    const t = convexTest(schema, modules);
    const feedId = await t.run((ctx) => ctx.db.insert("feeds", { source: "fixture", name: "fixture", url: FEED_URL, enabled: true, intervalMinutes: 60 }));
    await t.mutation(api.users.upsert, { deviceId: "d", role: "student", interests: [], city: "Mountain View", lat: 37.39, lng: -122.08, locationSource: "city" });

    await t.action(internal.ingest.runFeed, { feedId });
    items = [a];
    await t.action(internal.ingest.runFeed, { feedId });
    const rows = await t.run((ctx) => ctx.db.query("events").collect());
    expect(rows).toHaveLength(2);
    expect(rows.find((e) => e.sourceId === "b")?.hiddenAt).toBeDefined();
    expect(rows.find((e) => e.sourceId === "a")?.hiddenAt).toBeUndefined();
    const ranked = await t.query(api.feed.ranked, { deviceId: "d" });
    expect(ranked?.events.map((e) => e.title)).toEqual([a.title]);

    items = [a, b];
    await t.action(internal.ingest.runFeed, { feedId });
    expect((await eventBy(t, "b")).hiddenAt).toBeUndefined();
    expect((await t.query(api.feed.ranked, { deviceId: "d" }))?.events).toHaveLength(2);
  }, 30_000);

  test("a merged event stays visible until every source that listed it drops it", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const ids = await t.run(async (ctx) => {
      const feedId = await ctx.db.insert("feeds", { source: "ical", name: "one", url: "https://one.test/cal.ics", enabled: true, intervalMinutes: 60 });
      const listing = (sourceId: string) =>
        ctx.db.insert("raw_listings", { feedId, source: "ical", sourceId, raw: raw(sourceId, "https://example.org/" + sourceId, { source: "ical" }), fetchedAt: now - 1000 });
      const [one, two] = [await listing("one"), await listing("two")];
      const event = await ctx.db.insert("events", {
        title: "Founders demo night",
        description: "",
        startTime: Date.parse("2026-12-07T17:30:00-08:00"),
        timezone: "America/Los_Angeles",
        city: "",
        isOnline: false,
        url: "https://example.org/one",
        source: "ical",
        sourceId: "one",
        hosts: [],
        tags: [],
        eventType: "networking",
        audience: [],
        investorScore: 0,
        investorSignals: [],
        lastSeenAt: now,
        rawListingId: one,
        sources: [
          { url: "https://example.org/one", source: "ical", sourceId: "one" },
          { url: "https://example.org/two", source: "ical", sourceId: "two" },
        ],
      });
      return { one, two, event };
    });
    const hide = (listingId: typeof ids.one) => t.run(async (ctx) => (await import("./lib/store")).markListingsGone(ctx, [listingId]));
    expect(await hide(ids.one)).toBe(0);
    expect((await t.run((ctx) => ctx.db.get(ids.event)))?.hiddenAt).toBeUndefined();
    expect(await hide(ids.two)).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(ids.event)))?.hiddenAt).toBeDefined();
    expect((await t.query(internal.qa.report, {})).totals).toMatchObject({ events: 0, hidden: 1, upcoming: 0 });
  });
});

describe("same-source listings merged into one row", () => {
  test("re-ingesting either listing updates the shared row instead of inserting a duplicate", async () => {
    const t = convexTest(schema, modules);
    const at = (time: string) => `2026-12-10T${time}:00-08:00`;
    const sf = { online: false, address: "Founders Hall, San Francisco, CA" };
    const luma = raw("luma-1", "https://luma.com/pitch-sf", { source: "ical", title: "Startup Pitch & Networking in San Francisco", startsAt: at("18:00"), location: sf });
    const fuzzy = raw("eb-1", "https://www.eventbrite.com/e/1", { source: "eventbrite", title: "Startup Pitch and Networking in San Francisco!", startsAt: at("18:30"), location: sf });
    const exact = raw("eb-2", "https://www.eventbrite.com/e/2", { source: "eventbrite", title: "Startup Pitch & Networking in San Francisco", startsAt: at("18:00"), location: sf });
    const { normalize } = await import("./normalize");
    const store = async (r: RawEvent) => t.run(async (ctx) => (await import("./lib/store")).upsertEvent(ctx, (await normalize(r))!));
    const first = await store(luma);
    expect((await store(fuzzy)).id).toBe(first.id);
    expect((await store(exact)).id).toBe(first.id);
    expect((await store(fuzzy)).id).toBe(first.id);
    expect((await store(exact)).id).toBe(first.id);
    const rows = await t.run((ctx) => ctx.db.query("events").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].sources?.map((x) => x.sourceId).sort()).toEqual(["eb-1", "eb-2", "luma-1"]);
  });
});

describe("default feeds", () => {
  test("the Devpost in-person default is the seed list's URL, and the old duplicate is disabled", async () => {
    const t = convexTest(schema, modules);
    const oldUrl = "https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&challenge_type[]=in-person";
    const seedUrl = "https://devpost.com/api/hackathons?challenge_type[]=in-person&status[]=upcoming&status[]=open";
    await t.run((ctx) => ctx.db.insert("feeds", { source: "devpost", name: "Devpost in-person hackathons", url: oldUrl, enabled: true, intervalMinutes: 360 }));
    await t.mutation(internal.feeds.seed, { feeds: [{ source: "devpost", name: "Devpost: in-person open/upcoming (all)", url: seedUrl, intervalMinutes: 360, tier: "feed" }] });
    await t.mutation(internal.ingest.ensureFeeds, {});
    const devpost = (await t.run((ctx) => ctx.db.query("feeds").collect())).filter((f) => f.source === "devpost" && f.enabled);
    const inPerson = devpost.filter((f) => f.url.includes("in-person"));
    expect(inPerson.map((f) => f.url)).toEqual([seedUrl]);
  });
});
