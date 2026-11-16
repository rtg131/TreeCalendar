import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import { BAY_AREA_CITIES, foldText } from "./lib/geo";
import { FUZZY_WINDOW_MS, TITLE_SIMILARITY_MIN, titleSimilarity } from "./normalize/dedupe";

const HOUR = 3600_000;
const DEFAULT_DURATION = 3 * HOUR;
const DEMO_SOURCES = new Set(["seed", "fixture"]);
const BAY_CITIES = new Set(BAY_AREA_CITIES.map((c) => c.name));

const count = (into: Record<string, number>, key: string) => {
  into[key] = (into[key] ?? 0) + 1;
};

const placeOf = (e: Doc<"events">) => (e.isOnline ? "online" : foldText(e.city || e.venue || ""));

export type DuplicatePair = { a: string; b: string; aSource: string; bSource: string; city: string; similarity: number; minutesApart: number };

export const report = internalQuery({
  args: { now: v.optional(v.number()), looseMin: v.optional(v.number()) },
  handler: async (ctx, { now = Date.now(), looseMin = 0.7 }) => {
    const feeds = await ctx.db.query("feeds").collect();
    const feedById = new Map(feeds.map((f) => [f._id, f]));
    const crawled = (await ctx.db.query("events").collect()).filter((e) => !DEMO_SOURCES.has(e.source) && !e.synthetic);
    const all = crawled.filter((e) => e.hiddenAt === undefined);
    const upcoming = all.filter((e) => (e.endTime ?? e.startTime + DEFAULT_DURATION) >= now);

    const tierOf = new Map<Id<"events">, string>();
    for (const e of upcoming) {
      const listing = e.rawListingId ? await ctx.db.get(e.rawListingId) : null;
      const feed = listing?.feedId ? feedById.get(listing.feedId) : undefined;
      tierOf.set(e._id, feed?.tier ?? "unknown");
    }

    const bySource: Record<string, number> = {};
    const byTier: Record<string, number> = {};
    const byCity: Record<string, number> = {};
    const where = { bayAreaInPerson: 0, online: 0, noLocation: 0 };
    const missing = { coordinates: 0, venue: 0, endTime: 0 };
    for (const e of upcoming) {
      count(bySource, e.source);
      count(byTier, tierOf.get(e._id)!);
      count(byCity, e.city || "(none)");
      if (e.isOnline) where.online++;
      else if (e.lat !== undefined || BAY_CITIES.has(e.city)) where.bayAreaInPerson++;
      else where.noLocation++;
      if (!e.isOnline && (e.lat === undefined || e.lng === undefined)) missing.coordinates++;
      if (!e.isOnline && !e.venue) missing.venue++;
      if (e.endTime === undefined) missing.endTime++;
    }

    const sorted = [...upcoming].sort((a, b) => a.startTime - b.startTime);
    const pairs: DuplicatePair[] = [];
    const loose: DuplicatePair[] = [];
    const dupIds = new Set<Id<"events">>();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length && sorted[j].startTime - sorted[i].startTime <= FUZZY_WINDOW_MS; j++) {
        const [a, b] = [sorted[i], sorted[j]];
        if (placeOf(a) !== placeOf(b)) continue;
        const similarity = titleSimilarity(a.title, b.title);
        if (similarity < looseMin) continue;
        const pair = {
          a: a.title,
          b: b.title,
          aSource: `${a.source}:${a.sourceId}`,
          bSource: `${b.source}:${b.sourceId}`,
          city: a.city || a.venue || "",
          similarity: Math.round(similarity * 100) / 100,
          minutesApart: Math.round((b.startTime - a.startTime) / 60_000),
        };
        if (similarity >= TITLE_SIMILARITY_MIN) {
          pairs.push(pair);
          dupIds.add(b._id);
        } else loose.push(pair);
      }
    }

    const merged = upcoming.filter((e) => (e.sources?.length ?? 1) > 1);
    const fetchStats = await Promise.all(
      feeds
        .filter((f) => f.enabled)
        .map(async (f) => {
          const last = await ctx.db
            .query("fetch_log")
            .withIndex("by_feed", (q) => q.eq("feedId", f._id))
            .order("desc")
            .first();
          return {
            name: f.name,
            source: f.source,
            tier: f.tier ?? "",
            url: f.url,
            status: last?.status ?? "never",
            rawCount: last?.rawCount ?? 0,
            insertedCount: last?.insertedCount ?? 0,
            error: last?.error,
          };
        }),
    );

    return {
      now,
      totals: { events: all.length, hidden: crawled.length - all.length, upcoming: upcoming.length, ...where },
      bySource,
      byTier,
      byCity,
      missing,
      duplicates: {
        flaggedPairs: pairs.length,
        eventsInExcess: dupIds.size,
        rate: upcoming.length ? Math.round((dupIds.size / upcoming.length) * 10000) / 100 : 0,
        pairs,
        loose: loose.sort((x, y) => y.similarity - x.similarity).slice(0, 40),
      },
      merges: {
        rows: merged.length,
        sample: merged.slice(0, 30).map((e) => ({ title: e.title, city: e.city, sources: (e.sources ?? []).map((s) => `${s.source}:${s.url}`) })),
      },
      feeds: fetchStats,
    };
  },
});
