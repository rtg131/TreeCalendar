import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const event = (source: string) => ({
  source, sourceId: "prep-integration", title: "Prep integration demo", description: "Student founder demos",
  startTime: Date.UTC(2020, 0, 1), endTime: Date.UTC(2020, 0, 1, 3), timezone: "America/Los_Angeles",
  city: "San Francisco", isOnline: false, url: `https://example.com/${source}`, hosts: [source], tags: [],
  eventType: "demo_day" as const, audience: ["students" as const], investorScore: 0,
  investorSignals: [], lastSeenAt: 0,
});

beforeEach(() => { vi.stubEnv("PREP_API_KEY", ""); });
afterEach(() => { vi.unstubAllEnvs(); });

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.mutation(api.users.upsert, { deviceId: "prep-integration", role: "student", interests: [], city: "SF", lat: 37.7, lng: -122.4, locationSource: "city" });
  const [keep, drop] = await t.run(async (ctx) => [await ctx.db.insert("events", event("first")), await ctx.db.insert("events", event("second"))]);
  for (const eventId of [keep, drop]) {
    await t.action(api.prep.generateBriefing, { deviceId: "prep-integration", eventId });
    await t.action(api.prep.generateFollowup, { deviceId: "prep-integration", eventId, recipient: eventId === keep ? "Canonical contact" : "Other contact" });
    await t.run((ctx) => ctx.db.insert("attendance", { userId, eventId, going: true }));
    await t.mutation(api.saves.toggle, { deviceId: "prep-integration", eventId });
  }
  return { t, userId, keep, drop };
}

test("real dedupe backfill moves attendance and saves with prep, invalidates briefing, and preserves recipient", async () => {
  const { t, keep, drop } = await setup();
  await t.mutation(internal.normalize.backfill.run, { batchSize: 50 });
  expect(await t.run((ctx) => ctx.db.get(drop))).toBeNull();
  expect((await t.query(api.saves.list, { deviceId: "prep-integration" })).map((row) => row._id)).toEqual([keep]);
  expect(await t.query(api.attendance.mine, { deviceId: "prep-integration" })).toEqual([{ eventId: keep, going: true }]);
  expect(await t.run((ctx) => ctx.db.query("prep_briefings").collect())).toEqual([]);
  const followups = await t.run((ctx) => ctx.db.query("prep_followups").collect());
  expect(followups).toHaveLength(1);
  expect(followups[0].eventId).toBe(keep);
  expect((await t.query(api.prep.get, { deviceId: "prep-integration", eventId: keep })).followup?.recipient).toBe("Canonical contact");
  const regenerated = await t.action(api.prep.generateBriefing, { deviceId: "prep-integration", eventId: keep });
  expect(regenerated.people.join(" ")).toContain("second");
  await t.mutation(internal.normalize.backfill.run, { batchSize: 50 });
  expect(await t.run((ctx) => ctx.db.query("prep_followups").collect())).toEqual(followups);
});

test("real fixture purge deletes prep and attendance references without touching unrelated cards or device limits", async () => {
  const { t, keep, drop } = await setup();
  await t.run((ctx) => ctx.db.patch(drop, { synthetic: true }));
  const snapshot = () => t.run(async (ctx) => ({
    briefing: await ctx.db.query("prep_briefings").withIndex("by_event", (q) => q.eq("eventId", keep)).unique(),
    followup: await ctx.db.query("prep_followups").withIndex("by_event", (q) => q.eq("eventId", keep)).unique(),
    rates: await ctx.db.query("prep_rates").collect(),
  }));
  const before = await snapshot();
  vi.stubEnv("ENABLE_TEST_FIXTURES", "1");
  await t.mutation(internal.fixtures.purgeSynthetic, {});
  await t.mutation(internal.fixtures.purgeSynthetic, {});
  expect(await snapshot()).toEqual(before);
  expect(await t.run((ctx) => ctx.db.get(drop))).toBeNull();
  expect((await t.run((ctx) => ctx.db.query("prep_briefings").collect())).map((row) => row.eventId)).toEqual([keep]);
  expect((await t.run((ctx) => ctx.db.query("prep_followups").collect())).map((row) => row.eventId)).toEqual([keep]);
  expect(await t.query(api.attendance.mine, { deviceId: "prep-integration" })).toEqual([{ eventId: keep, going: true }]);
});
