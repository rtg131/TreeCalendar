import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import devpostClub from "../fixtures/normalize/devpost-club.json";
import lumaPair from "../fixtures/normalize/luma-ical-jsonld.json";
import meetupCrosspost from "../fixtures/normalize/meetup-crosspost.json";
import nearMisses from "../fixtures/normalize/near-misses.json";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { RawEvent } from "./lib/rawEvent";
import { upsertEvent } from "./lib/store";
import { normalize, type NormalizedEvent } from "./normalize";
import { dedupeKey, titleSimilarity } from "./normalize/dedupe";
import { embedderFromEnv } from "./normalize/embed";
import { geocodeKey, NOMINATIM_URL } from "./normalize/geocode";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

type Pair = { name?: string; a: RawEvent; b: RawEvent };
const PAIRS: [string, Pair][] = [
  ["Luma iCal + Luma JSON-LD page", lumaPair as Pair],
  ["Devpost + club page", devpostClub as Pair],
];

const noGeocode = async (query: string) => {
  throw new Error(`unexpected geocode: ${query}`);
};

async function normalized(raw: RawEvent): Promise<NormalizedEvent> {
  const event = await normalize(raw, { geocode: noGeocode });
  if (!event) throw new Error(`${raw.title} was dropped`);
  return event;
}

const events = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("events").collect());

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("cross-source dedupe", () => {
  test.each(PAIRS)("%s becomes one row", async (_, { a, b }) => {
    const t = convexTest(schema, modules);
    const [ea, eb] = [await normalized(a), await normalized(b)];
    const first = await t.run((ctx) => upsertEvent(ctx, ea));
    const second = await t.run((ctx) => upsertEvent(ctx, eb));
    expect(first).toMatchObject({ created: true, merged: false });
    expect(second).toEqual({ id: first.id, created: false, merged: true });

    const again = [await t.run((ctx) => upsertEvent(ctx, eb)), await t.run((ctx) => upsertEvent(ctx, ea))];
    expect(again.map((r) => r.id)).toEqual([first.id, first.id]);

    const rows = await events(t);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.sources).toEqual([
      { url: a.url, source: a.source, sourceId: a.sourceId },
      { url: b.url, source: b.source, sourceId: b.sourceId },
    ]);
    expect(row).toMatchObject({ source: a.source, sourceId: a.sourceId, url: a.url, title: a.title, startTime: Date.parse(a.startsAt) });
    expect(row.description.length).toBe(Math.max(a.description.length, b.description.length));
    expect(row.venue).toBeDefined();
    expect(row.imageUrl).toBe(a.imageUrl ?? b.imageUrl);
    expect(row.timezone).toBe("America/Los_Angeles");
    expect(row.endTime).toBe(Date.parse((a.endsAt ?? b.endsAt)!));
  });

  test("Luma pair takes the JSON-LD page's richer fields", async () => {
    const t = convexTest(schema, modules);
    for (const raw of [lumaPair.a, lumaPair.b] as RawEvent[]) await t.run(async (ctx) => upsertEvent(ctx, await normalized(raw)));
    const [row] = await events(t);
    expect(row).toMatchObject({ venue: "WorkOS", address: "WorkOS, San Francisco, California, US", organizer: "WorkOS Events", city: "San Francisco" });
    expect(row.hosts).toContain("Michael Grinich");
  });

  test("Devpost pair matches fuzzily across a one-hour start difference", async () => {
    const [a, b] = [await normalized(devpostClub.a as RawEvent), await normalized(devpostClub.b as RawEvent)];
    expect(dedupeKey(a)).not.toBe(dedupeKey(b));
    expect(titleSimilarity(a.title, b.title)).toBeGreaterThanOrEqual(0.85);
  });

  test("one event cross-posted to two Meetup groups merges within a source when title and start match exactly", async () => {
    const t = convexTest(schema, modules);
    const [a, b] = [await normalized(meetupCrosspost.a as RawEvent), await normalized(meetupCrosspost.b as RawEvent)];
    const first = await t.run((ctx) => upsertEvent(ctx, a));
    expect(await t.run((ctx) => upsertEvent(ctx, b))).toEqual({ id: first.id, created: false, merged: true });
    const rows = await events(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].sources?.map((s: { url: string }) => s.url)).toEqual([a.url, b.url]);
    expect(rows[0].description).toBe(b.description);
  });

  test("saves on the first-seen row survive a merge", async () => {
    const t = convexTest(schema, modules);
    const { id } = await t.run(async (ctx) => upsertEvent(ctx, await normalized(lumaPair.a as RawEvent)));
    await t.mutation(api.users.upsert, { deviceId: "d1", role: "student", interests: [], city: "San Francisco", lat: 37.77, lng: -122.42, locationSource: "city" });
    const userId = (await t.run((ctx) => ctx.db.query("users").first()))!._id;
    await t.run((ctx) => ctx.db.insert("saves", { userId, eventId: id, savedAt: Date.now() }));
    await t.run(async (ctx) => upsertEvent(ctx, await normalized(lumaPair.b as RawEvent)));
    const saved = await t.run(async (ctx) => ctx.db.get((await ctx.db.query("saves").first())!.eventId));
    expect(saved?.sources).toHaveLength(2);
  });

  test.each((nearMisses as Pair[]).map((p) => [p.name!, p] as const))("near miss stays separate: %s", async (_, { a, b }) => {
    const t = convexTest(schema, modules);
    const ids = [await t.run(async (ctx) => upsertEvent(ctx, await normalized(a))), await t.run(async (ctx) => upsertEvent(ctx, await normalized(b)))];
    expect(ids.map((r) => r.created)).toEqual([true, true]);
    expect(await events(t)).toHaveLength(2);
  });
});

describe("backfill", () => {
  test("merges pre-dedupe duplicates into the earliest row and moves saves", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const raws = [lumaPair.a, lumaPair.b, devpostClub.a, devpostClub.b, nearMisses[0].a, nearMisses[0].b] as RawEvent[];
    const ids: Id<"events">[] = [];
    for (const raw of raws) {
      const event = await normalized(raw);
      ids.push(await t.run(async (ctx) => ctx.db.insert("events", { ...event, rawListingId: await ctx.db.insert("raw_listings", { source: raw.source, sourceId: raw.sourceId, raw, fetchedAt: 0 }), lastSeenAt: 0 })));
    }
    await t.mutation(api.users.upsert, { deviceId: "d1", role: "student", interests: [], city: "San Francisco", lat: 37.77, lng: -122.42, locationSource: "city" });
    const userId = (await t.run((ctx) => ctx.db.query("users").first()))!._id;
    await t.run((ctx) => ctx.db.insert("saves", { userId, eventId: ids[1], savedAt: 0 }));

    await t.mutation(internal.normalize.backfill.run, { batchSize: 2 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const rows = await events(t);
    expect(rows.map((r) => r._id).sort()).toEqual([ids[0], ids[2], ids[4], ids[5]].sort());
    expect(rows.every((r) => r.dedupeKey && r.sources?.length)).toBe(true);
    expect(rows.find((r) => r._id === ids[0])?.sources).toHaveLength(2);
    expect(rows.find((r) => r._id === ids[2])?.sources).toHaveLength(2);
    const saves = await t.run((ctx) => ctx.db.query("saves").collect());
    expect(saves.map((s) => s.eventId)).toEqual([ids[0]]);
  });
});

describe("geocoding", () => {
  test("retries a failed Nominatim request instead of caching nothing", async () => {
    let failures = 1;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (!String(input).startsWith(NOMINATIM_URL)) throw new Error(`unexpected live fetch: ${input}`);
      if (failures-- > 0) throw new Error("socket hang up");
      return new Response(JSON.stringify([{ lat: "49.26", lon: "-123.11", address: { city: "Vancouver" } }]));
    });
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    expect(await t.action(internal.normalize.geocode.lookup, { query: "Vancouver, Canada" })).toMatchObject({ city: "Vancouver" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await t.run((ctx) => ctx.db.query("geocode_cache").collect())).toMatchObject([{ key: "vancouver canada", lat: 49.26 }]);
  });

  const nominatimHits: Record<string, unknown[]> = {
    "2495 bancroft way berkeley ca 94720 usa": [{ lat: "37.8687", lon: "-122.2594", address: { city: "Berkeley" } }],
    "1401 n shoreline blvd": [{ lat: "37.4143", lon: "-122.0774", address: { city: "Mountain View" } }],
  };

  function stubFetch(extra: (url: URL) => Response | undefined = () => undefined) {
    const calls: { url: string; userAgent: string | null }[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url: url.toString(), userAgent: new Headers(init?.headers).get("User-Agent") });
      if (url.toString().startsWith(NOMINATIM_URL)) {
        return new Response(JSON.stringify(nominatimHits[geocodeKey(url.searchParams.get("q")!)] ?? []), { headers: { "content-type": "application/json" } });
      }
      const res = extra(url);
      if (res) return res;
      throw new Error(`unexpected live fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
  }

  test("caches Nominatim results by normalized address and sends a descriptive User-Agent", async () => {
    const calls = stubFetch();
    const t = convexTest(schema, modules);
    const hit = await t.action(internal.normalize.geocode.lookup, { query: "2495 Bancroft Way, Berkeley, CA 94720, USA" });
    expect(hit).toEqual({ lat: 37.8687, lng: -122.2594, city: "Berkeley" });
    expect(await t.action(internal.normalize.geocode.lookup, { query: "2495  BANCROFT WAY berkeley ca 94720 USA" })).toEqual(hit);
    expect(calls).toHaveLength(1);
    expect(calls[0].userAgent).toMatch(/github\.com\/waddlethegreat1\/cac/);
    const cache = await t.run((ctx) => ctx.db.query("geocode_cache").collect());
    expect(cache).toMatchObject([{ key: "2495 bancroft way berkeley ca 94720 usa", lat: 37.8687, lng: -122.2594 }]);
  });

  test("a cached row answers without calling Nominatim, and misses are cached too", async () => {
    const calls = stubFetch();
    const t = convexTest(schema, modules);
    await t.mutation(internal.normalize.geocode.putCached, { key: geocodeKey("Hanahaus, Palo Alto"), hit: { lat: 37.4447, lng: -122.1617, city: "Palo Alto" } });
    expect(await t.action(internal.normalize.geocode.lookup, { query: "Hanahaus, Palo Alto" })).toMatchObject({ city: "Palo Alto" });
    expect(calls).toHaveLength(0);
    expect(await t.action(internal.normalize.geocode.lookup, { query: "Nowhere Hall" })).toBeNull();
    expect(await t.action(internal.normalize.geocode.lookup, { query: "Nowhere Hall" })).toBeNull();
    expect(calls).toHaveLength(2);
    calls.length = 0;
    expect(await t.action(internal.normalize.geocode.lookup, { query: "Seminar Room B, 11-25 Kurahara-cho, Miyakonojo, Japan" })).toBeNull();
    expect(calls.map((c) => new URL(c.url).searchParams.get("q"))).toEqual([
      "Seminar Room B, 11-25 Kurahara-cho, Miyakonojo, Japan",
      "Seminar Room B, 11-25 Kurahara-cho, Miyakonojo, Japan",
      "11-25 Kurahara-cho, Miyakonojo, Japan",
      "11-25 Kurahara-cho, Miyakonojo, Japan",
      "Miyakonojo, Japan",
      "Miyakonojo, Japan",
    ]);
  }, 20_000);

  test("runFeed geocodes table misses and keeps ungeocodable events with no coordinates", async () => {
    const raws: Partial<RawEvent>[] = [
      { sourceId: "chm", title: "Mountain View AI Hackathon", location: { online: false, name: "Computer History Museum", address: "1401 N Shoreline Blvd" } },
      { sourceId: "secret", title: "Warehouse Hack Night", location: { online: false, name: "Unmarked warehouse" } },
      { sourceId: "known", title: "Palo Alto Hackathon", location: { online: false, name: "Hanahaus, Palo Alto" } },
    ];
    const body = raws.map((r) => ({ description: "Student hackathon.", url: `https://fixtures.test/${r.sourceId}`, startsAt: "2026-12-12T10:00:00-08:00", timezone: "America/Los_Angeles", ...r }));
    const calls = stubFetch((url) =>
      url.pathname === "/robots.txt" ? new Response("", { status: 404 }) : url.pathname === "/events.json" ? new Response(JSON.stringify(body)) : undefined,
    );
    const t = convexTest(schema, modules);
    const feedId = await t.run((ctx) => ctx.db.insert("feeds", { source: "fixture", name: "fixture", url: "https://fixtures.test/events.json", enabled: true, intervalMinutes: 60 }));
    expect(await t.action(internal.ingest.runFeed, { feedId })).toEqual({ fetched: 3, kept: 3 });
    const rows = await events(t);
    expect(rows.find((r) => r.sourceId === "chm")).toMatchObject({ lat: 37.4143, lng: -122.0774, city: "Mountain View" });
    expect(rows.find((r) => r.sourceId === "secret")).toMatchObject({ city: "" });
    expect(rows.find((r) => r.sourceId === "secret")?.lat).toBeUndefined();
    expect(rows.find((r) => r.sourceId === "known")).toMatchObject({ city: "Palo Alto", lat: 37.4419 });
    expect(calls.filter((c) => c.url.startsWith(NOMINATIM_URL))).toHaveLength(3);
  }, 15_000);

  test("prefers a Bay Area match, then falls back to the world and to the address without its venue", async () => {
    const answer = (url: URL) => {
      const q = geocodeKey(url.searchParams.get("q")!);
      const bounded = url.searchParams.get("bounded") === "1";
      if (q === "evans 597") return bounded ? [{ lat: "37.8737", lon: "-122.2578", address: { city: "Berkeley" } }] : [{ lat: "42.62", lon: "-79.06", address: { village: "Angola" } }];
      if (q === "madrid spain") return bounded ? [] : [{ lat: "40.4167", lon: "-3.7033", address: { city: "Madrid" } }];
      return [];
    };
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (!url.toString().startsWith(NOMINATIM_URL)) throw new Error(`unexpected live fetch: ${url}`);
        calls.push(`${url.searchParams.get("q")}|${url.searchParams.get("bounded") ?? "0"}`);
        return new Response(JSON.stringify(answer(url)));
      }),
    );
    const t = convexTest(schema, modules);
    expect(await t.action(internal.normalize.geocode.lookup, { query: "Evans 597" })).toMatchObject({ city: "Berkeley" });
    expect(await t.action(internal.normalize.geocode.lookup, { query: "HappyRobot Madrid Office, Madrid, Spain" })).toMatchObject({ city: "Madrid" });
    expect(calls).toEqual([
      "Evans 597|1",
      "HappyRobot Madrid Office, Madrid, Spain|1",
      "HappyRobot Madrid Office, Madrid, Spain|0",
      "Madrid, Spain|1",
      "Madrid, Spain|0",
    ]);
  }, 15_000);
});

test("embed step is a no-op without EMBED_API_KEY", () => {
  expect(embedderFromEnv({})).toBeNull();
  expect(embedderFromEnv({ EMBED_API_KEY: "k" })).not.toBeNull();
});
