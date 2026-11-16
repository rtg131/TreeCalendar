import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";

export const DEFAULT_INTERVAL_MINUTES = 360;

export const seedFeed = v.object({
  source: v.string(),
  name: v.string(),
  url: v.string(),
  intervalMinutes: v.optional(v.number()),
  enabled: v.optional(v.boolean()),
  tier: v.optional(v.string()),
});

export const seed = internalMutation({
  args: { feeds: v.array(seedFeed), disableSources: v.optional(v.array(v.string())) },
  returns: v.object({ inserted: v.number(), updated: v.number(), unchanged: v.number(), disabled: v.number() }),
  handler: async (ctx, { feeds, disableSources }) => {
    const now = Date.now();
    const counts = { inserted: 0, updated: 0, unchanged: 0, disabled: 0 };
    for (const source of disableSources ?? []) {
      const rows = await ctx.db
        .query("feeds")
        .withIndex("by_source", (q) => q.eq("source", source))
        .collect();
      for (const row of rows.filter((r) => r.enabled)) {
        await ctx.db.patch(row._id, { enabled: false });
        counts.disabled++;
      }
    }
    for (const feed of feeds) {
      const fields = {
        source: feed.source,
        name: feed.name,
        intervalMinutes: feed.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES,
        enabled: feed.enabled ?? true,
        tier: feed.tier,
      };
      const existing = await ctx.db
        .query("feeds")
        .withIndex("by_url", (q) => q.eq("url", feed.url))
        .first();
      if (!existing) {
        await ctx.db.insert("feeds", { ...fields, url: feed.url, nextFetchAt: now });
        counts.inserted++;
        continue;
      }
      const changed = (Object.keys(fields) as (keyof typeof fields)[]).some(
        (key) => existing[key] !== fields[key],
      );
      if (!changed) {
        counts.unchanged++;
        continue;
      }
      await ctx.db.patch(existing._id, fields);
      counts.updated++;
    }
    return counts;
  },
});

export function selectDueFeeds(ctx: QueryCtx, now: number, limit = 25) {
  return ctx.db
    .query("feeds")
    .withIndex("by_enabled_nextFetchAt", (q) => q.eq("enabled", true).lte("nextFetchAt", now))
    .take(limit);
}

export const recentFetches = internalQuery({
  args: { feedId: v.id("feeds"), limit: v.optional(v.number()) },
  handler: async (ctx, { feedId, limit }) =>
    ctx.db
      .query("fetch_log")
      .withIndex("by_feed", (q) => q.eq("feedId", feedId))
      .order("desc")
      .take(limit ?? 20),
});
