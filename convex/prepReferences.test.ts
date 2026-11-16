import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { deletePrepReferences, rekeyPrepReferences } from "./prepReferences";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

test("dedupe rekeys followups, prefers survivor collisions, and invalidates all merged caches", async () => {
  const t = convexTest(schema, modules);
  const [keep, drop] = await t.run(async (ctx) => {
    const fields = { title: "Demo", description: "A demo", startTime: 1, timezone: "UTC", city: "SF", isOnline: false, url: "https://example.com", source: "fixture", sourceId: "keep", hosts: [], tags: [], eventType: "demo_day" as const, audience: [], investorScore: 0, investorSignals: [], lastSeenAt: 1 };
    return [await ctx.db.insert("events", fields), await ctx.db.insert("events", { ...fields, sourceId: "drop" })];
  });
  for (const deviceId of ["one", "two"]) await t.mutation(api.users.upsert, { deviceId, role: "student", interests: [], city: "SF", lat: 1, lng: 1, locationSource: "city" });
  await t.action(api.prep.generateBriefing, { deviceId: "one", eventId: keep });
  await t.action(api.prep.generateBriefing, { deviceId: "one", eventId: drop });
  await t.action(api.prep.generateFollowup, { deviceId: "one", eventId: keep, recipient: "Keep recipient" });
  await t.action(api.prep.generateFollowup, { deviceId: "one", eventId: drop, recipient: "Drop recipient" });
  await t.action(api.prep.generateFollowup, { deviceId: "two", eventId: drop, recipient: "Second recipient" });
  await t.run(async (ctx) => {
    await ctx.db.patch(keep, { title: "Merged Demo" });
    await rekeyPrepReferences(ctx, drop, keep);
    await ctx.db.delete(drop);
  });
  expect(await t.run((ctx) => ctx.db.query("prep_briefings").collect())).toEqual([]);
  const rows = await t.run((ctx) => ctx.db.query("prep_followups").collect());
  expect(rows.map((row) => row.value.recipient).sort()).toEqual(["Keep recipient", "Second recipient"]);
  expect(rows.every((row) => row.eventId === keep && row.value.email.includes("Merged Demo"))).toBe(true);
  expect(await t.query(api.prep.get, { deviceId: "one", eventId: keep })).toMatchObject({ briefing: null, followup: { recipient: "Keep recipient" } });
  expect(await t.query(api.prep.get, { deviceId: "two", eventId: keep })).toMatchObject({ briefing: null, followup: { recipient: "Second recipient" } });
  await t.run((ctx) => rekeyPrepReferences(ctx, drop, keep));
  await t.run((ctx) => rekeyPrepReferences(ctx, keep, keep));
  expect(await t.run((ctx) => ctx.db.query("prep_followups").collect())).toHaveLength(2);
  await t.run((ctx) => deletePrepReferences(ctx, keep));
  expect(await t.run((ctx) => ctx.db.query("prep_followups").collect())).toEqual([]);
  await t.run((ctx) => deletePrepReferences(ctx, keep));
});
