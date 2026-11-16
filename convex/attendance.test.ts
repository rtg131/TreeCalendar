import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const NOW = Date.UTC(2026, 10, 15, 12);
const DAY = 86_400_000;
const beforeEnd = async <T>(fn: () => Promise<T>) => {
  vi.setSystemTime(NOW - 2 * DAY);
  try { return await fn(); } finally { vi.setSystemTime(NOW); }
};
const userArgs = (deviceId: string) => ({
  deviceId, role: "student" as const, interests: ["ai"], city: "San Francisco",
  lat: 37.77, lng: -122.42, locationSource: "city" as const,
});
const eventArgs = (sourceId: string, startTime = NOW - 86_400_000, endTime?: number) => ({
  source: "test", sourceId, title: sourceId, description: "Offline fixture", startTime,
  ...(endTime === undefined ? {} : { endTime }), timezone: "America/Los_Angeles",
  city: "San Francisco", isOnline: false, url: "https://example.com", hosts: [], tags: [],
  eventType: "networking" as const, audience: ["students" as const], investorScore: 0,
  investorSignals: [], lastSeenAt: NOW,
});

async function setup() {
  vi.setSystemTime(NOW - 3 * DAY);
  const t = convexTest(schema, modules);
  const alice = await t.mutation(api.users.upsert, userArgs("alice"));
  const bob = await t.mutation(api.users.upsert, userArgs("bob"));
  const eventId = await t.run((ctx) => ctx.db.insert("events", eventArgs("past")));
  vi.setSystemTime(NOW);
  return { t, alice, bob, eventId, args: { deviceId: "alice", eventId } };
}

describe("attendance", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  test("going is idempotent, independent of saves, and scoped by device", async () => {
    const { t, alice, bob, args, eventId } = await setup();
    expect(await t.query(api.attendance.mine, { deviceId: "unknown" })).toEqual([]);
    expect(await t.query(api.attendance.pending, { deviceId: "unknown", now: NOW })).toEqual([]);
    expect(await t.query(api.attendance.history, { deviceId: "unknown" })).toEqual([]);
    await beforeEnd(async () => { for (let i = 0; i < 2; i++) await t.mutation(api.attendance.setGoing, { ...args, going: true }); });
    expect(await t.query(api.attendance.mine, { deviceId: "alice" })).toEqual([{ eventId, going: true }]);
    expect(await t.query(api.attendance.mine, { deviceId: "bob" })).toEqual([]);
    expect(await t.query(api.saves.isSaved, args)).toBe(false);
    expect((await t.query(internal.attendance.goingForUser, { userId: alice })).map((e) => e._id)).toEqual([eventId]);
    expect(await t.query(internal.attendance.goingForUser, { userId: bob })).toEqual([]);
    await t.mutation(api.attendance.setGoing, { ...args, going: false });
    await t.mutation(api.attendance.setGoing, { ...args, going: false });
    expect(await t.query(api.attendance.pending, { deviceId: "alice", now: NOW })).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("attendance").collect())).toHaveLength(1);
  });

  test("going cannot be set once an event has ended, but an existing commitment can still be withdrawn", async () => {
    const { t, args, eventId } = await setup();
    const activeId = await t.run((ctx) => ctx.db.insert("events", eventArgs("active-now", NOW - 3_600_000, NOW + 3_600_000)));
    const ended = (promise: Promise<unknown>) => promise.then(() => "ok", (e: { data?: { code?: string } }) => e.data?.code ?? String(e));
    expect(await ended(t.mutation(api.attendance.setGoing, { ...args, going: true }))).toBe("event_ended");
    await expect(t.mutation(api.attendance.setGoing, { ...args, going: true })).rejects.toThrow("already ended");
    expect(await t.run((ctx) => ctx.db.query("attendance").collect())).toEqual([]);
    await t.mutation(api.attendance.setGoing, { ...args, eventId: activeId, going: true });
    vi.setSystemTime(NOW + 2 * 3_600_000);
    expect(await ended(t.mutation(api.attendance.setGoing, { ...args, eventId: activeId, going: true }))).toBe("event_ended");
    expect(await t.query(api.attendance.mine, { deviceId: "alice" })).toEqual([{ eventId: activeId, going: true }]);
    await t.mutation(api.attendance.setGoing, { ...args, eventId: activeId, going: false });
    expect(await ended(t.mutation(api.attendance.setGoing, { ...args, eventId: activeId, going: true }))).toBe("event_ended");
    expect(await t.query(api.attendance.mine, { deviceId: "alice" })).toEqual([{ eventId: activeId, going: false }]);
    expect(eventId).toBeDefined();
  });

  test("pending uses end time or a three-hour fallback, excludes active events, and cannot be advanced by clients", async () => {
    const { t, args, eventId } = await setup();
    const [futureId, activeId, fallbackId] = await beforeEnd(async () => {
      const ids = [
        await t.run((ctx) => ctx.db.insert("events", eventArgs("future", NOW + 86_400_000))),
        await t.run((ctx) => ctx.db.insert("events", eventArgs("active", NOW - 86_400_000, NOW + 3_600_000))),
        await t.run((ctx) => ctx.db.insert("events", eventArgs("fallback", NOW - 3 * 3_600_000))),
      ];
      for (const id of [eventId, ...ids]) await t.mutation(api.attendance.setGoing, { ...args, eventId: id, going: true });
      return ids;
    });
    expect((await t.query(api.attendance.pending, { deviceId: "alice", now: NOW })).map((e) => e._id)).toEqual([eventId, fallbackId]);
    expect((await t.query(api.attendance.pending, { deviceId: "alice", now: NOW + 999_999_999 })).map((e) => e._id)).toEqual([eventId, fallbackId]);
    expect(await t.query(api.attendance.pending, { deviceId: "alice", now: NOW - 999_999_999 })).toEqual([]);
    await expect(t.query(api.attendance.pending, { deviceId: "alice", now: Infinity })).rejects.toThrow("Invalid time");
    await expect(t.mutation(api.attendance.respond, { ...args, eventId: activeId, attended: false })).rejects.toThrow("ended commitment");
    await expect(t.mutation(api.attendance.dismiss, { ...args, eventId: futureId })).rejects.toThrow("ended commitment");
  });

  test("a dismissal persists once across retries, toggling going, and repeat seeds", async () => {
    const { t } = await setup();
    const seeded = await t.mutation(internal.attendanceSeed.run, { deviceId: "alice" });
    const args = { deviceId: "alice", eventId: seeded.pendingEventId! };
    await t.mutation(api.attendance.dismiss, args);
    const snapshot = await t.run((ctx) => ctx.db.query("attendance").collect());
    expect(snapshot.some((r) => r.dismissedAt !== undefined && r.dismissedAt >= NOW)).toBe(true);
    vi.setSystemTime(NOW + 10_000);
    await t.mutation(api.attendance.dismiss, args);
    await t.mutation(api.attendance.setGoing, { ...args, going: false });
    await expect(t.mutation(api.attendance.setGoing, { ...args, going: true })).rejects.toThrow("already ended");
    await t.run(async (ctx) => {
      const record = (await ctx.db.query("attendance").collect()).find((r) => r.eventId === args.eventId && r.dismissedAt !== undefined)!;
      await ctx.db.patch(record._id, { going: true });
    });
    await t.mutation(internal.attendanceSeed.run, { deviceId: "alice" });
    expect(await t.query(api.attendance.pending, { deviceId: "alice", now: NOW + 10_000 })).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("attendance").collect())).toEqual(snapshot);
  });

  test("responses require an onboarded user's own ended commitment", async () => {
    const { t, args, eventId } = await setup();
    await expect(t.mutation(api.attendance.setGoing, { ...args, deviceId: "unknown", going: true })).rejects.toThrow("onboarding");
    await expect(t.mutation(api.attendance.respond, { ...args, attended: false })).rejects.toThrow("ended commitment");
    await expect(t.mutation(api.attendance.dismiss, args)).rejects.toThrow("ended commitment");
    await beforeEnd(() => t.mutation(api.attendance.setGoing, { ...args, going: true }));
    await expect(t.mutation(api.attendance.respond, { ...args, deviceId: "bob", attended: false })).rejects.toThrow("ended commitment");
    await expect(t.mutation(api.attendance.dismiss, { ...args, deviceId: "bob" })).rejects.toThrow("ended commitment");
    await expect(t.mutation(api.attendance.respond, { ...args, deviceId: "unknown", attended: false })).rejects.toThrow("onboarding");
    await expect(t.mutation(api.attendance.dismiss, { ...args, deviceId: "unknown" })).rejects.toThrow("onboarding");
    await t.mutation(api.attendance.setGoing, { ...args, going: false });
    await expect(t.mutation(api.attendance.respond, { ...args, attended: false })).rejects.toThrow("ended commitment");
    await t.run((ctx) => ctx.db.delete(eventId));
    await expect(t.mutation(api.attendance.setGoing, { ...args, going: true })).rejects.toThrow("Event not found");
  });

  test("validates ratings, conditional requirements, enum, and one-line notes", async () => {
    const { t, args } = await setup();
    await beforeEnd(() => t.mutation(api.attendance.setGoing, { ...args, going: true }));
    const response = { ...args, attended: true, rating: 4, investors: "yes" as const };
    for (const rating of [0, 11, 1.5, NaN, Infinity, -Infinity]) await expect(t.mutation(api.attendance.respond, { ...response, rating })).rejects.toThrow("integer from 1 to 10");
    await expect(t.mutation(api.attendance.respond, { ...args, attended: true, rating: 4 })).rejects.toThrow("requires");
    await expect(t.mutation(api.attendance.respond, { ...args, attended: true, investors: "no" })).rejects.toThrow("requires");
    await expect(t.mutation(api.attendance.respond, { ...response, attended: false })).rejects.toThrow("Only attendees");
    for (const note of ["x".repeat(241), "two\nlines", "two\rlines", "two\u2028lines", "two\u2029lines", "two\u0085lines"]) await expect(t.mutation(api.attendance.respond, { ...response, note })).rejects.toThrow("one line");
    await expect(t.mutation(api.attendance.respond, { ...response, investors: "maybe" as "yes" })).rejects.toThrow();
    await t.mutation(api.attendance.respond, { ...response, rating: 1, note: "😀".repeat(240) });
    await t.mutation(api.attendance.respond, { ...response, rating: 10, note: "" });
    expect(await t.query(api.attendance.pending, { deviceId: "alice", now: NOW })).toEqual([]);
    expect(await t.query(api.attendance.history, { deviceId: "bob" })).toEqual([]);
  });

  test("no-shows answer the prompt permanently and stay out of history and aggregates", async () => {
    const { t, args } = await setup();
    await beforeEnd(() => t.mutation(api.attendance.setGoing, { ...args, going: true }));
    await t.mutation(api.attendance.respond, { ...args, attended: false, note: "Couldn't make it" });
    await t.mutation(api.attendance.setGoing, { ...args, going: false });
    await expect(t.mutation(api.attendance.setGoing, { ...args, going: true })).rejects.toThrow("already ended");
    await t.run(async (ctx) => {
      const record = (await ctx.db.query("attendance").collect())[0];
      await ctx.db.patch(record._id, { going: true });
    });
    expect(await t.query(api.attendance.pending, { deviceId: "alice", now: NOW })).toEqual([]);
    expect(await t.query(api.attendance.history, { deviceId: "alice" })).toEqual([]);
    expect(await t.query(api.attendance.aggregate, { eventId: args.eventId })).toBeNull();
    expect(await t.query(api.attendance.mine, { deviceId: "alice" })).toEqual([{ eventId: args.eventId, going: true, attended: false, note: "Couldn't make it" }]);
  });

  test("aggregate hides fewer than three ratings and exposes only exact counts and average, including edits/retries", async () => {
    const { t, args, eventId } = await setup();
    expect(await t.query(api.attendance.aggregate, { eventId })).toBeNull();
    await beforeEnd(async () => {
      for (const deviceId of ["alice", "bob", "charlie"]) {
        await t.mutation(api.users.upsert, userArgs(deviceId));
        await t.mutation(api.attendance.setGoing, { deviceId, eventId, going: true });
      }
    });
    for (const [i, deviceId] of ["alice", "bob", "charlie"].entries()) {
      const response = { deviceId, eventId, attended: true, rating: i + 3, investors: i === 0 ? "yes" as const : "unsure" as const, note: "private" };
      await t.mutation(api.attendance.respond, response);
      await t.mutation(api.attendance.respond, response);
      if (i < 2) expect(await t.query(api.attendance.aggregate, { eventId })).toBeNull();
    }
    expect(await t.query(api.attendance.aggregate, { eventId })).toEqual({ ratingCount: 3, averageWorthIt: 4, investorConfirmations: 1, ratingScale: 10 });
    await t.mutation(api.attendance.respond, { ...args, attended: true, rating: 9, investors: "no" });
    expect(await t.query(api.attendance.aggregate, { eventId })).toEqual({ ratingCount: 3, averageWorthIt: 6, investorConfirmations: 0, ratingScale: 10 });
    await t.mutation(api.attendance.respond, { ...args, attended: false });
    expect(await t.query(api.attendance.aggregate, { eventId })).toBeNull();
  });

  test("history returns attended events newest first, null notes, and survives un-going; deleted events are omitted", async () => {
    const { t, args, eventId } = await setup();
    const newer = await beforeEnd(async () => {
      const id = await t.run((ctx) => ctx.db.insert("events", eventArgs("newer", NOW - 4 * 3_600_000)));
      for (const eventToCommit of [eventId, id]) await t.mutation(api.attendance.setGoing, { ...args, eventId: eventToCommit, going: true });
      return id;
    });
    for (const id of [eventId, newer]) {
      await t.mutation(api.attendance.respond, { ...args, eventId: id, attended: true, rating: 4, investors: "no" });
    }
    await t.mutation(api.attendance.setGoing, { ...args, going: false });
    const history = await t.query(api.attendance.history, { deviceId: "alice" });
    expect(history.map((r) => r.event._id)).toEqual([newer, eventId]);
    expect(history[0]).toEqual({ event: await t.run((ctx) => ctx.db.get(newer)), rating: 4, note: null, investors: "no" });
    await t.run((ctx) => ctx.db.delete(newer));
    expect((await t.query(api.attendance.history, { deviceId: "alice" })).map((r) => r.event._id)).toEqual([eventId]);
    expect(await t.query(internal.attendance.goingForUser, { userId: (await t.query(api.users.get, { deviceId: "alice" }))!._id })).toEqual([]);
  });

  test("migrateRatingsTo10 doubles legacy ratings and sums exactly once, and legacy rows read on the 10 scale before it runs", async () => {
    const { t, alice, bob, eventId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("attendance", { userId: alice, eventId, going: true, attended: true, rating: 4, investors: "yes" });
      await ctx.db.insert("attendance", { userId: bob, eventId, going: true, attended: true, rating: 2, investors: "no" });
      await ctx.db.insert("attendance", { userId: alice, eventId: await ctx.db.insert("events", eventArgs("other")), going: true });
      await ctx.db.insert("attendance_totals", { eventId, ratingCount: 3, ratingSum: 9, investorConfirmations: 1 });
    });
    expect(await t.query(api.attendance.aggregate, { eventId })).toEqual({ ratingCount: 3, averageWorthIt: 6, investorConfirmations: 1, ratingScale: 10 });
    expect((await t.query(api.attendance.history, { deviceId: "alice" }))[0].rating).toBe(8);
    expect(await t.mutation(internal.attendance.migrateRatingsTo10, {})).toEqual({ attendance: 3, totals: 1, more: false });
    const once = await t.run(async (ctx) => ({ records: await ctx.db.query("attendance").collect(), totals: await ctx.db.query("attendance_totals").collect() }));
    expect(once.records.map((r) => r.rating)).toEqual([8, 4, undefined]);
    expect(once.totals[0]).toMatchObject({ ratingSum: 18, ratingScale: 10 });
    expect(await t.mutation(internal.attendance.migrateRatingsTo10, {})).toEqual({ attendance: 0, totals: 0, more: false });
    expect(await t.run(async (ctx) => ({ records: await ctx.db.query("attendance").collect(), totals: await ctx.db.query("attendance_totals").collect() }))).toEqual(once);
    expect(await t.query(api.attendance.aggregate, { eventId })).toEqual({ ratingCount: 3, averageWorthIt: 6, investorConfirmations: 1, ratingScale: 10 });
  });

  test("a new response on an unmigrated event converts its legacy totals instead of mixing scales", async () => {
    const { t, alice, bob, eventId } = await setup();
    await t.mutation(api.users.upsert, userArgs("charlie"));
    await t.run(async (ctx) => {
      await ctx.db.insert("attendance", { userId: alice, eventId, going: true, attended: true, rating: 5, investors: "yes" });
      await ctx.db.insert("attendance", { userId: bob, eventId, going: true, attended: true, rating: 3, investors: "no" });
      const charlie = (await ctx.db.query("users").withIndex("by_device", (q) => q.eq("deviceId", "charlie")).unique())!._id;
      await ctx.db.insert("attendance", { userId: charlie, eventId, going: true });
      await ctx.db.insert("attendance_totals", { eventId, ratingCount: 2, ratingSum: 8, investorConfirmations: 1 });
    });
    await t.mutation(api.attendance.respond, { deviceId: "charlie", eventId, attended: true, rating: 7, investors: "unsure" });
    await t.mutation(api.attendance.respond, { deviceId: "alice", eventId, attended: true, rating: 10, investors: "yes" });
    expect(await t.query(api.attendance.aggregate, { eventId })).toEqual({ ratingCount: 3, averageWorthIt: 23 / 3, investorConfirmations: 1, ratingScale: 10 });
    await t.mutation(internal.attendance.migrateRatingsTo10, {});
    expect(await t.query(api.attendance.aggregate, { eventId })).toEqual({ ratingCount: 3, averageWorthIt: 23 / 3, investorConfirmations: 1, ratingScale: 10 });
  });

  test("seed is idempotent, clearly fictional, immediately aggregated, and leaves other seeds unchanged", async () => {
    const { t, eventId } = await setup();
    await t.mutation(internal.seed.run, {});
    const before = await t.run((ctx) => ctx.db.query("events").collect());
    const first = await t.mutation(internal.attendanceSeed.run, {});
    expect(first.eventIds).toHaveLength(3);
    expect(first.pendingEventId).toBeNull();
    for (const id of first.eventIds) {
      const event = await t.run((ctx) => ctx.db.get(id));
      expect(event?.title).toContain("[DEMO]");
      expect(event?.endTime).toBeLessThan(NOW);
      expect(await t.query(api.attendance.aggregate, { eventId: id })).toEqual({ ratingCount: 3, averageWorthIt: 8, investorConfirmations: 1, ratingScale: 10 });
    }
    const allBefore = await t.run(async (ctx) => ({ events: await ctx.db.query("events").collect(), users: await ctx.db.query("users").collect(), attendance: await ctx.db.query("attendance").collect(), totals: await ctx.db.query("attendance_totals").collect() }));
    vi.setSystemTime(NOW + 86_400_000);
    expect(await t.mutation(internal.attendanceSeed.run, {})).toEqual(first);
    expect(await t.run(async (ctx) => ({ events: await ctx.db.query("events").collect(), users: await ctx.db.query("users").collect(), attendance: await ctx.db.query("attendance").collect(), totals: await ctx.db.query("attendance_totals").collect() }))).toEqual(allBefore);
    for (const event of before) expect(await t.run((ctx) => ctx.db.get(event._id))).toEqual(event);
    expect(await t.query(api.attendance.aggregate, { eventId })).toBeNull();
    const demo = await t.mutation(internal.attendanceSeed.run, { deviceId: "new-demo-device" });
    expect((await t.query(api.attendance.pending, { deviceId: "new-demo-device", now: NOW + 86_400_000 })).map((e) => e._id)).toEqual([demo.pendingEventId]);
    expect((await t.query(api.attendance.history, { deviceId: "new-demo-device" })).map((r) => r.event._id)).toEqual([demo.historyEventId]);
    expect(await t.query(api.attendance.mine, { deviceId: "alice" })).toEqual([]);
  });
});
