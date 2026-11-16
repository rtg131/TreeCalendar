import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { RawEvent } from "./lib/rawEvent";
import { INVESTORS_LIKELY_MIN } from "./lib/ranking";
import { normalize } from "./normalize";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

const student = {
  deviceId: "device-1",
  role: "student" as const,
  interests: ["hackathons", "ai"],
  city: "Stanford",
  lat: 37.4275,
  lng: -122.1697,
  locationSource: "city" as const,
};

const rawHackathon = (startsAt: string): RawEvent => ({
  source: "devpost",
  sourceId: "123",
  title: "Bay Area AI Hackathon",
  description: "In-person hackathon.",
  url: "https://example.devpost.com",
  startsAt,
  timezone: "America/Los_Angeles",
  location: { online: false, name: "Stanford University" },
  sourceEventType: "hackathon",
});

describe("backend", () => {
  test("seed fills feeds, interests, and a ranked feed", async () => {
    const t = convexTest(schema, modules);
    const { seeded } = await t.mutation(internal.seed.run, {});
    expect(seeded).toBeGreaterThanOrEqual(20);
    expect((await t.query(api.interests.list, {})).map((i) => i.slug)).toContain("hackathons");
    const feeds = await t.run((ctx) => ctx.db.query("feeds").collect());
    expect(new Set(feeds.map((f) => f.source))).toEqual(new Set(["devpost", "luma", "mlh"]));
    expect(feeds.filter((f) => f.source === "mlh").map((f) => f.enabled)).toEqual([false]);

    expect(await t.query(api.feed.ranked, { deviceId: student.deviceId })).toBeNull();
    await t.mutation(api.users.upsert, student);
    const feed = await t.query(api.feed.ranked, { deviceId: student.deviceId });
    expect(feed?.events.length).toBeGreaterThan(10);
    expect(feed?.events[0].matched.length).toBeGreaterThan(0);

    const investorOnly = await t.query(api.feed.ranked, { deviceId: student.deviceId, filter: "investors" });
    expect(investorOnly?.events.every((e) => e.investorScore >= INVESTORS_LIKELY_MIN)).toBe(true);
  });

  test("store upserts by source and sourceId", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.ingest.ensureFeeds, {});
    const feedId = (await t.run((ctx) => ctx.db.query("feeds").first()))!._id;
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    for (const startsAt of [soon, soon]) {
      const raw = rawHackathon(startsAt);
      await t.mutation(internal.ingest.store, { feedId, items: [{ raw, event: await normalize(raw) }] });
    }
    const [listings, events] = await t.run(async (ctx) => [
      await ctx.db.query("raw_listings").collect(),
      await ctx.db.query("events").collect(),
    ]);
    expect(listings).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ city: "Stanford", eventType: "hackathon", source: "devpost" });
  });

  test("normalize drops events outside the Bay Area", async () => {
    const raw = { ...rawHackathon(new Date().toISOString()), location: { online: false, name: "ASU Tempe Campus" } };
    const geocode = async () => ({ lat: 33.4242, lng: -111.9281, city: "Tempe" });
    expect(await normalize(raw, { geocode })).toBeNull();
  });

  test("saves toggle per user", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.run, {});
    await t.mutation(api.users.upsert, student);
    const event = (await t.run((ctx) => ctx.db.query("events").first()))!;
    const args = { deviceId: student.deviceId, eventId: event._id };
    expect(await t.mutation(api.saves.toggle, args)).toBe(true);
    expect(await t.query(api.saves.isSaved, args)).toBe(true);
    expect((await t.query(api.saves.list, { deviceId: student.deviceId })).map((e) => e._id)).toEqual([event._id]);
    expect(await t.mutation(api.saves.toggle, args)).toBe(false);
    expect(await t.query(api.saves.list, { deviceId: student.deviceId })).toEqual([]);
  });
});
