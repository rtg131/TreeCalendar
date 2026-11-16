import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { deleteEventRefs, reassignEventRefs } from "./normalize/reassignEventRefs";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const event = (source: string) => ({
  source, sourceId: "duplicate", title: "Attendance dedupe fixture", description: "Offline fixture",
  startTime: Date.UTC(2020, 0, 1), endTime: Date.UTC(2020, 0, 1, 3), timezone: "America/Los_Angeles",
  city: "San Francisco", isOnline: false, url: `https://example.com/${source}`, hosts: [], tags: [],
  eventType: "networking" as const, audience: ["students" as const], investorScore: 0,
  investorSignals: [], lastSeenAt: 0,
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => [
    await ctx.db.insert("events", event("first")),
    await ctx.db.insert("events", event("second")),
    await ctx.db.insert("events", event("third")),
  ]);
  const user = (deviceId: string) => t.mutation(api.users.upsert, {
    deviceId, role: "student", interests: [], city: "San Francisco", lat: 37.77, lng: -122.42, locationSource: "city",
  });
  const attendance = (userId: Id<"users">, eventId: Id<"events">, fields: Partial<Pick<Doc<"attendance">, "going" | "attended" | "rating" | "investors" | "note" | "dismissedAt">> = {}) =>
    t.run((ctx) => ctx.db.insert("attendance", { userId, eventId, going: true, ratingScale: 10, ...fields }));
  const snapshot = () => t.run(async (ctx) => ({
    records: await ctx.db.query("attendance").collect(),
    totals: await ctx.db.query("attendance_totals").collect(),
  }));
  return { t, ids, user, attendance, snapshot };
}

describe("attendance across duplicate-event backfills", () => {
  test("fixture purge deletes attendance and totals transactionally without touching real event feedback", async () => {
    const { t, ids: [realId, syntheticId], user, attendance } = await setup();
    const userId = await user("purge-reviewer");
    await attendance(userId, realId, { attended: true, rating: 4, investors: "yes", note: "Keep this" });
    await attendance(userId, syntheticId, { attended: true, rating: 5, investors: "yes", note: "Synthetic" });
    await t.run(async (ctx) => {
      await ctx.db.patch(syntheticId, { synthetic: true });
      for (const eventId of [realId, syntheticId]) {
        await ctx.db.insert("attendance_totals", { eventId, ratingCount: 1, ratingSum: eventId === realId ? 4 : 5, investorConfirmations: 1, ratingScale: 10 as const });
        await ctx.db.insert("saves", { userId, eventId, savedAt: 1 });
      }
    });
    const before = await t.run(async (ctx) => ({
      attendance: await ctx.db.query("attendance").withIndex("by_event", (q) => q.eq("eventId", realId)).collect(),
      totals: await ctx.db.query("attendance_totals").withIndex("by_event", (q) => q.eq("eventId", realId)).collect(),
      saves: await ctx.db.query("saves").withIndex("by_event", (q) => q.eq("eventId", realId)).collect(),
    }));
    vi.stubEnv("ENABLE_TEST_FIXTURES", "1");
    try {
      expect(await t.mutation(internal.fixtures.purgeSynthetic, {})).toMatchObject({ events: 1, saves: 1 });
      expect(await t.mutation(internal.fixtures.purgeSynthetic, {})).toMatchObject({ events: 0, saves: 0 });
    } finally { vi.unstubAllEnvs(); }
    expect(await t.run(async (ctx) => ({
      attendance: await ctx.db.query("attendance").collect(),
      totals: await ctx.db.query("attendance_totals").collect(),
      saves: await ctx.db.query("saves").collect(),
    }))).toEqual(before);
    expect(await t.run((ctx) => ctx.db.get(syntheticId))).toBeNull();
    expect((await t.query(api.attendance.history, { deviceId: "purge-reviewer" })).map((r) => r.event._id)).toEqual([realId]);
  });

  test("deleting event references preserves unrelated events, profiles and references and is safe to retry", async () => {
    const { t, ids: [purge, unrelated], user, attendance } = await setup();
    const sharedUser = await user("shared");
    const unrelatedUser = await user("unrelated");
    await attendance(sharedUser, purge, { attended: true, rating: 5, investors: "yes", note: "Synthetic feedback" });
    await attendance(unrelatedUser, purge, { dismissedAt: 10 });
    await attendance(sharedUser, unrelated, { attended: true, rating: 3, investors: "no", note: "Real feedback" });
    await attendance(unrelatedUser, unrelated);
    await t.run(async (ctx) => {
      for (const eventId of [purge, unrelated]) {
        for (const userId of [sharedUser, unrelatedUser]) await ctx.db.insert("saves", { userId, eventId, savedAt: 10 });
        await ctx.db.insert("attendance_totals", { eventId, ratingCount: 1, ratingSum: eventId === purge ? 5 : 3, investorConfirmations: eventId === purge ? 1 : 0, ratingScale: 10 as const });
      }
    });
    const snapshot = () => t.run(async (ctx) => ({
      events: await ctx.db.query("events").collect(), users: await ctx.db.query("users").collect(),
      saves: await ctx.db.query("saves").collect(), attendance: await ctx.db.query("attendance").collect(),
      totals: await ctx.db.query("attendance_totals").collect(),
    }));
    const before = await snapshot();
    await t.run(async (ctx) => {
      await deleteEventRefs(ctx, purge);
      await ctx.db.delete(purge);
    });
    const expected = {
      events: before.events.filter((r) => r._id !== purge), users: before.users,
      saves: before.saves.filter((r) => r.eventId !== purge), attendance: before.attendance.filter((r) => r.eventId !== purge),
      totals: before.totals.filter((r) => r.eventId !== purge),
    };
    expect(await snapshot()).toEqual(expected);
    await t.run((ctx) => deleteEventRefs(ctx, purge));
    expect(await snapshot()).toEqual(expected);
    expect((await t.query(api.attendance.history, { deviceId: "shared" })).map((r) => r.event._id)).toEqual([unrelated]);
    expect(await t.query(api.attendance.mine, { deviceId: "shared" })).toEqual([{ eventId: unrelated, going: true, attended: true, rating: 3, investors: "no", note: "Real feedback" }]);
  });

  test("cleanup fails closed before deleting anything when the combined reference limit is exceeded", async () => {
    const { t, ids: [purge], user, attendance } = await setup();
    const userId = await user("limit");
    await attendance(userId, purge);
    await t.run(async (ctx) => {
      for (let i = 0; i < 3999; i++) await ctx.db.insert("saves", { userId, eventId: purge, savedAt: i });
      await ctx.db.insert("attendance_totals", { eventId: purge, ratingCount: 0, ratingSum: 0, investorConfirmations: 0, ratingScale: 10 as const });
    });
    await expect(t.run(async (ctx) => {
      await deleteEventRefs(ctx, purge);
      await ctx.db.delete(purge);
    })).rejects.toThrow("cleanup exceeds transaction limit");
    expect(await t.run((ctx) => ctx.db.get(purge))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.query("saves").collect())).toHaveLength(3999);
    expect(await t.run((ctx) => ctx.db.query("attendance").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("attendance_totals").collect())).toHaveLength(1);
  });

  test("the reusable hook moves saves and attendance together and tolerates retries and self-reassignment", async () => {
    const { t, ids: [keep, drop], user, attendance, snapshot } = await setup();
    const both = await user("both");
    const onlyDrop = await user("only-drop");
    await attendance(both, drop, { attended: true, rating: 5, investors: "yes" });
    await attendance(onlyDrop, drop);
    await t.run(async (ctx) => {
      await ctx.db.insert("saves", { userId: both, eventId: keep, savedAt: 10 });
      await ctx.db.insert("saves", { userId: both, eventId: drop, savedAt: 20 });
      await ctx.db.insert("saves", { userId: onlyDrop, eventId: drop, savedAt: 30 });
      await reassignEventRefs(ctx, drop, keep);
    });
    const saves = await t.run((ctx) => ctx.db.query("saves").collect());
    expect(saves).toHaveLength(2);
    expect(saves.every((s) => s.eventId === keep)).toBe(true);
    expect(saves.find((s) => s.userId === both)?.savedAt).toBe(10);
    expect(saves.find((s) => s.userId === onlyDrop)?.savedAt).toBe(30);
    const after = await snapshot();
    expect(after.records).toHaveLength(2);
    expect(after.records.every((r) => r.eventId === keep)).toBe(true);
    expect(after.totals).toHaveLength(1);
    expect(after.totals[0]).toMatchObject({ eventId: keep, ratingCount: 1, ratingSum: 5, investorConfirmations: 1 });
    await t.run(async (ctx) => {
      await reassignEventRefs(ctx, drop, keep);
      await reassignEventRefs(ctx, keep, keep);
    });
    expect(await snapshot()).toEqual(after);
    expect(await t.run((ctx) => ctx.db.query("saves").collect())).toEqual(saves);
  });

  test("moves pending commitments and retains going, notes, no-shows and first dismissals", async () => {
    const { t, ids: [keep, drop, third], user, attendance, snapshot } = await setup();
    const pendingUser = await user("pending");
    const dismissedUser = await user("dismissed");
    const absentUser = await user("absent");
    const canceledUser = await user("canceled");
    await attendance(pendingUser, keep, { going: false });
    await attendance(pendingUser, drop);
    await attendance(dismissedUser, keep, { going: false, dismissedAt: 20 });
    await attendance(dismissedUser, drop, { dismissedAt: 10, note: "Remember this venue" });
    await attendance(dismissedUser, third, { dismissedAt: 30 });
    await attendance(absentUser, drop, { attended: false, note: "Could not go" });
    await attendance(canceledUser, drop, { going: false });

    await t.mutation(internal.normalize.backfill.run, { batchSize: 50 });
    expect((await t.query(api.attendance.pending, { deviceId: "pending", now: Date.now() })).map((e) => e._id)).toEqual([keep]);
    expect(await t.query(api.attendance.mine, { deviceId: "pending" })).toEqual([{ eventId: keep, going: true }]);
    expect(await t.query(api.attendance.pending, { deviceId: "dismissed", now: Date.now() })).toEqual([]);
    expect(await t.query(api.attendance.mine, { deviceId: "dismissed" })).toEqual([{ eventId: keep, going: true, note: "Remember this venue" }]);
    expect(await t.query(api.attendance.mine, { deviceId: "absent" })).toEqual([{ eventId: keep, going: true, attended: false, note: "Could not go" }]);
    expect(await t.query(api.attendance.history, { deviceId: "absent" })).toEqual([]);
    expect(await t.query(api.attendance.pending, { deviceId: "absent", now: Date.now() })).toEqual([]);
    expect(await t.query(api.attendance.mine, { deviceId: "canceled" })).toEqual([{ eventId: keep, going: false }]);
    expect(await t.query(internal.attendance.goingForUser, { userId: canceledUser })).toEqual([]);
    const after = await snapshot();
    expect(after.records).toHaveLength(4);
    expect(after.records.find((r) => r.userId === dismissedUser)?.dismissedAt).toBe(10);
    expect(after.records.every((r) => r.eventId === keep)).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(drop))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(third))).toBeNull();
    await t.mutation(internal.normalize.backfill.run, { batchSize: 50 });
    expect(await snapshot()).toEqual(after);
    await t.mutation(api.attendance.respond, { deviceId: "pending", eventId: keep, attended: false });
    expect(await t.query(api.attendance.pending, { deviceId: "pending", now: Date.now() })).toEqual([]);
  });

  test("chooses one deterministic response per user and rebuilds exact totals rather than summing duplicates", async () => {
    const { t, ids: [keep, drop, third], user, attendance, snapshot } = await setup();
    const dualUser = await user("dual");
    const conflictingUser = await user("conflicting");
    const movedUser = await user("moved");
    await attendance(dualUser, keep, { going: false, attended: true, rating: 2, investors: "no", note: "Canonical note" });
    await attendance(dualUser, keep, { attended: true, rating: 1, investors: "yes", note: "Later duplicate row" });
    await attendance(dualUser, drop, { attended: true, rating: 5, investors: "yes", note: "Duplicate note" });
    await attendance(dualUser, third, { attended: true, rating: 4, investors: "yes" });
    await attendance(conflictingUser, keep, { going: false, attended: false, note: "Existing note", dismissedAt: 10 });
    await attendance(conflictingUser, drop, { attended: true, rating: 4, investors: "yes", dismissedAt: 20 });
    await attendance(movedUser, third, { going: false, attended: true, rating: 3, investors: "unsure" });
    await t.run(async (ctx) => {
      for (const eventId of [keep, drop, third]) await ctx.db.insert("attendance_totals", { eventId, ratingCount: 50, ratingSum: 250, investorConfirmations: 50, ratingScale: 10 as const });
    });

    await t.mutation(internal.normalize.backfill.run, { batchSize: 50 });
    const after = await snapshot();
    expect(after.records).toHaveLength(3);
    expect(after.records.every((r) => r.eventId === keep)).toBe(true);
    expect(after.records.find((r) => r.userId === dualUser)).toMatchObject({ going: true, attended: true, rating: 2, investors: "no", note: "Canonical note" });
    expect(after.records.find((r) => r.userId === conflictingUser)).toMatchObject({ going: true, attended: true, rating: 4, investors: "yes", note: "Existing note", dismissedAt: 10 });
    expect(after.totals).toHaveLength(1);
    expect(after.totals[0]).toMatchObject({ eventId: keep, ratingCount: 3, ratingSum: 9, investorConfirmations: 1 });
    expect(await t.query(api.attendance.aggregate, { eventId: keep })).toEqual({ ratingCount: 3, averageWorthIt: 3, investorConfirmations: 1, ratingScale: 10 });
    for (const id of [drop, third]) {
      expect(await t.query(api.attendance.aggregate, { eventId: id })).toBeNull();
      expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
    }
    for (const deviceId of ["dual", "conflicting", "moved"]) {
      expect((await t.query(api.attendance.history, { deviceId })).map((r) => r.event._id)).toEqual([keep]);
      expect(await t.query(api.attendance.pending, { deviceId, now: Date.now() })).toEqual([]);
    }
    expect((await t.query(api.attendance.history, { deviceId: "moved" }))[0]).toMatchObject({ rating: 3, investors: "unsure", note: null });
    await t.mutation(internal.normalize.backfill.run, { batchSize: 50 });
    expect(await snapshot()).toEqual(after);

    const response = { deviceId: "dual", eventId: keep, attended: true, rating: 5, investors: "yes" as const };
    await t.mutation(api.attendance.respond, response);
    await t.mutation(api.attendance.respond, response);
    expect(await t.query(api.attendance.aggregate, { eventId: keep })).toEqual({ ratingCount: 3, averageWorthIt: 4, investorConfirmations: 2, ratingScale: 10 });
    await t.mutation(api.attendance.respond, { deviceId: "dual", eventId: keep, attended: false });
    expect(await t.query(api.attendance.aggregate, { eventId: keep })).toBeNull();
  });

  test("removes orphaned totals even when neither event has attendance rows", async () => {
    const { t, ids: [keep, drop, third], snapshot } = await setup();
    await t.run(async (ctx) => {
      for (const eventId of [keep, drop, third]) await ctx.db.insert("attendance_totals", { eventId, ratingCount: 3, ratingSum: 15, investorConfirmations: 3, ratingScale: 10 as const });
    });
    await t.mutation(internal.normalize.backfill.run, { batchSize: 50 });
    expect(await snapshot()).toEqual({ records: [], totals: [] });
    expect(await t.query(api.attendance.aggregate, { eventId: keep })).toBeNull();
    await t.mutation(internal.normalize.backfill.run, { batchSize: 50 });
    expect(await snapshot()).toEqual({ records: [], totals: [] });
  });
});
