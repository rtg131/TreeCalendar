import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 15, 20);

const row = (sourceId: string, o: Record<string, unknown> = {}) => ({
  title: `Event ${sourceId}`,
  description: "",
  startTime: NOW + 2 * DAY,
  timezone: "America/Los_Angeles",
  city: "San Francisco",
  lat: 37.77,
  lng: -122.42,
  isOnline: false,
  url: `https://example.com/${sourceId}`,
  source: "ical",
  sourceId,
  hosts: [],
  tags: [],
  eventType: "networking" as const,
  audience: [],
  investorScore: 0,
  investorSignals: [],
  lastSeenAt: NOW,
  ...o,
});

describe("qa.report", () => {
  test("counts upcoming events, missing fields, unmerged duplicates, and feed yield", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const feedId = await ctx.db.insert("feeds", { source: "ical", name: "Cal", url: "https://example.com/cal.ics", enabled: true, intervalMinutes: 60, tier: "feed" });
      await ctx.db.insert("fetch_log", { feedId, startedAt: NOW, finishedAt: NOW, durationMs: 0, status: "ok", rawCount: 4, insertedCount: 3 });
      await ctx.db.insert("events", row("a", { title: "AI Founders Mixer", venue: "The Commons", endTime: NOW + 2 * DAY + 3600_000 }));
      await ctx.db.insert("events", row("b", { title: "AI Founders Mixer!", startTime: NOW + 2 * DAY + 3600_000 }));
      await ctx.db.insert("events", row("c", { lat: undefined, lng: undefined, city: "" }));
      await ctx.db.insert("events", row("d", { isOnline: true, city: "Online" }));
      await ctx.db.insert("events", row("past", { startTime: NOW - 2 * DAY }));
      await ctx.db.insert("events", row("demo", { source: "seed" }));
    });
    const r = await t.query(internal.qa.report, { now: NOW });
    expect(r.totals).toEqual({ events: 5, hidden: 0, upcoming: 4, bayAreaInPerson: 2, online: 1, noLocation: 1 });
    expect(r.missing).toEqual({ coordinates: 1, venue: 2, endTime: 3 });
    expect(r.duplicates).toMatchObject({ flaggedPairs: 1, eventsInExcess: 1, rate: 25 });
    expect(r.duplicates.pairs[0]).toMatchObject({ a: "AI Founders Mixer", b: "AI Founders Mixer!", minutesApart: 60 });
    expect(r.feeds).toEqual([expect.objectContaining({ name: "Cal", status: "ok", rawCount: 4, insertedCount: 3 })]);
  });
});
