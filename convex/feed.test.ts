import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { INVESTORS_LIKELY_MIN } from "./lib/ranking";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

const user = {
  deviceId: "device-radius",
  role: "student" as const,
  interests: ["ai"],
  city: "San Francisco",
  lat: 37.7749,
  lng: -122.4194,
  locationSource: "city" as const,
};

const event = (
  sourceId: string,
  place: { lat?: number; lng?: number; isOnline?: boolean; venue?: string; investorScore?: number },
) => ({
  title: `Event ${sourceId}`,
  description: "",
  startTime: Date.now() + 2 * 86_400_000,
  timezone: "America/Los_Angeles",
  city: "San Francisco",
  isOnline: false,
  url: `https://example.com/${sourceId}`,
  source: "jsonld",
  sourceId,
  hosts: [],
  tags: ["ai", "networking"],
  eventType: "networking" as const,
  audience: ["founders" as const, "developers" as const],
  investorScore: 10,
  investorSignals: [],
  lastSeenAt: Date.now(),
  ...place,
});

async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(api.users.upsert, user);
  await t.run(async (ctx) => {
    await ctx.db.insert("events", event("near", { lat: 37.7849, lng: -122.4094, venue: "Noisebridge" }));
    await ctx.db.insert("events", event("far", { lat: 37.4275, lng: -122.1697, venue: "Stanford" }));
    await ctx.db.insert("events", event("online", { isOnline: true, lat: 40.7128, lng: -74.006 }));
    await ctx.db.insert("events", event("nowhere", {}));
  });
  return t;
}

const ids = (feed: { events: { title: string }[] } | null) => feed!.events.map((e) => e.title.replace("Event ", "")).sort();

describe("feed radius and card fields", () => {
  test("radiusKm drops out-of-range events and keeps online and unlocated ones", async () => {
    const t = await setup();
    expect(ids(await t.query(api.feed.ranked, { deviceId: user.deviceId }))).toEqual(["far", "near", "nowhere", "online"]);
    expect(ids(await t.query(api.feed.ranked, { deviceId: user.deviceId, radiusKm: 10 }))).toEqual(["near", "nowhere", "online"]);
    expect(ids(await t.query(api.feed.ranked, { deviceId: user.deviceId, radiusKm: 100 }))).toEqual(["far", "near", "nowhere", "online"]);
  });

  test("returns tags, audience, source and venue as stored", async () => {
    const t = await setup();
    const feed = await t.query(api.feed.ranked, { deviceId: user.deviceId });
    const near = feed!.events.find((e) => e.title === "Event near")!;
    expect(near).toMatchObject({
      tags: ["ai", "networking"],
      audience: ["founders", "developers"],
      source: "jsonld",
      venue: "Noisebridge",
    });
    expect(feed!.events.find((e) => e.title === "Event nowhere")!.venue).toBeUndefined();
  });

  test("returns stored coordinates for located events and omits them for unlocated ones", async () => {
    const t = await setup();
    const feed = await t.query(api.feed.ranked, { deviceId: user.deviceId });
    const near = feed!.events.find((e) => e.title === "Event near")!;
    expect(near.lat).toBe(37.7849);
    expect(near.lng).toBe(-122.4094);
    const nowhere = feed!.events.find((e) => e.title === "Event nowhere")!;
    expect(nowhere).not.toHaveProperty("lat");
    expect(nowhere).not.toHaveProperty("lng");
  });

  test("users.upsert stores radiusKm, keeps it when omitted, and the feed uses it by default", async () => {
    const t = await setup();
    await t.mutation(api.users.upsert, { ...user, radiusKm: 10 });
    expect((await t.query(api.users.get, { deviceId: user.deviceId }))!.radiusKm).toBe(10);
    expect(ids(await t.query(api.feed.ranked, { deviceId: user.deviceId }))).toEqual(["near", "nowhere", "online"]);
    expect(ids(await t.query(api.feed.ranked, { deviceId: user.deviceId, radiusKm: 100 }))).toEqual(["far", "near", "nowhere", "online"]);
    await t.mutation(api.users.upsert, { ...user, interests: ["hackathons"] });
    expect((await t.query(api.users.get, { deviceId: user.deviceId }))!.radiusKm).toBe(10);
    await t.mutation(api.users.upsert, { ...user, radiusKm: 25 });
    expect((await t.query(api.users.get, { deviceId: user.deviceId }))!.radiusKm).toBe(25);
  });

  test("the investors filter starts at INVESTORS_LIKELY_MIN", async () => {
    expect(INVESTORS_LIKELY_MIN).toBe(70);
    const t = convexTest(schema, modules);
    await t.mutation(api.users.upsert, user);
    await t.run(async (ctx) => {
      await ctx.db.insert("events", event("below", { isOnline: true, investorScore: INVESTORS_LIKELY_MIN - 1 }));
      await ctx.db.insert("events", event("at", { isOnline: true, investorScore: INVESTORS_LIKELY_MIN }));
    });
    expect(ids(await t.query(api.feed.ranked, { deviceId: user.deviceId, filter: "investors" }))).toEqual(["at"]);
  });
});
