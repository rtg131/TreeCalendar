import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { resolveAdapter } from "./adapters";
import { selectDueFeeds } from "./feeds";
import { RobotsDisallowedError, makeHttp } from "./lib/http";
import { rawEvent } from "./lib/rawEvent";
import { ensureDefaults, markListingsGone, upsertEvent, upsertRawListing } from "./lib/store";
import { normalize } from "./normalize";
import { embedderFromEnv } from "./normalize/embed";
import { enrichTarget, isEnrichable, mediaFrom, needsFetch, needsMedia, needsPlace, readPage, type EnrichTarget } from "./normalize/enrich";
import { nominatimGeocoder } from "./normalize/geocode";
import { normalizedEvent } from "./schema";

const BATCH = 50;
const SWEEP_BATCH = 50;
const MINUTE = 60_000;
const fetchStatus = v.union(v.literal("ok"), v.literal("error"), v.literal("skipped_robots"));

export const ensureFeeds = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ensureDefaults(ctx);
    return null;
  },
});

export const getFeed = internalQuery({
  args: { feedId: v.id("feeds") },
  handler: (ctx, { feedId }) => ctx.db.get(feedId),
});

export const store = internalMutation({
  args: {
    feedId: v.id("feeds"),
    items: v.array(v.object({ raw: rawEvent, event: v.union(normalizedEvent, v.null()) })),
  },
  returns: v.array(enrichTarget),
  handler: async (ctx, { feedId, items }) => {
    const dropped: Id<"raw_listings">[] = [];
    const enrich: EnrichTarget[] = [];
    for (const { raw, event } of items) {
      const rawListingId = await upsertRawListing(ctx, raw, feedId);
      let kept = event;
      if (kept && (needsPlace(kept) || needsMedia(kept)) && isEnrichable(kept.url)) {
        const page = await readPage(ctx, kept.url);
        if (needsFetch(page, kept)) enrich.push({ url: kept.url, source: kept.source, sourceId: kept.sourceId });
        if (page && needsPlace(kept) && page.outsideBayArea) kept = null;
        else if (page) kept = { ...kept, ...(needsPlace(kept) ? page.place : undefined), ...mediaFrom(page, kept) };
      }
      if (kept) await upsertEvent(ctx, kept, rawListingId);
      else dropped.push(rawListingId);
    }
    await markListingsGone(ctx, dropped);
    return enrich;
  },
});

export const sweep = internalMutation({
  args: { feedId: v.id("feeds"), startedAt: v.number() },
  returns: v.object({ swept: v.number(), hidden: v.number() }),
  handler: async (ctx, { feedId, startedAt }) => {
    const stale = await ctx.db
      .query("raw_listings")
      .withIndex("by_feed_missing_fetchedAt", (q) => q.eq("feedId", feedId).eq("missingSince", undefined).lt("fetchedAt", startedAt))
      .take(SWEEP_BATCH);
    const hidden = await markListingsGone(ctx, stale.map((l) => l._id));
    return { swept: stale.length, hidden };
  },
});

export const logFetch = internalMutation({
  args: {
    feedId: v.id("feeds"),
    startedAt: v.number(),
    status: fetchStatus,
    rawCount: v.number(),
    insertedCount: v.number(),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const finishedAt = Date.now();
    await ctx.db.insert("fetch_log", { ...args, finishedAt, durationMs: finishedAt - args.startedAt });
    const feed = await ctx.db.get(args.feedId);
    if (!feed) return null;
    await ctx.db.patch(args.feedId, {
      lastFetchedAt: finishedAt,
      nextFetchAt: finishedAt + feed.intervalMinutes * MINUTE,
      lastStatus: args.status === "ok" ? "ok" : "error",
    });
    return null;
  },
});

export const runFeed = internalAction({
  args: { feedId: v.id("feeds") },
  returns: v.object({ fetched: v.number(), kept: v.number() }),
  handler: async (ctx, { feedId }): Promise<{ fetched: number; kept: number }> => {
    const feed: Doc<"feeds"> | null = await ctx.runQuery(internal.ingest.getFeed, { feedId });
    if (!feed) throw new Error(`Unknown feed ${feedId}`);
    const startedAt = Date.now();
    const adapter = resolveAdapter(feed);
    if (!adapter) {
      const error = `No adapter for source ${feed.source}${feed.tier ? ` or tier ${feed.tier}` : ""}`;
      await ctx.runMutation(internal.ingest.logFetch, { feedId, startedAt, status: "error", rawCount: 0, insertedCount: 0, error });
      return { fetched: 0, kept: 0 };
    }
    try {
      const raws = await adapter.fetch(feed, makeHttp(ctx));
      const geocode = nominatimGeocoder(ctx);
      const items = await Promise.all(raws.map(async (raw) => ({ raw, event: await normalize(raw, { geocode }) })));
      await embedderFromEnv()?.embed(items.flatMap((i) => (i.event ? [i.event] : [])));
      const enrich: EnrichTarget[] = [];
      for (let i = 0; i < items.length; i += BATCH) {
        enrich.push(...(await ctx.runMutation(internal.ingest.store, { feedId, items: items.slice(i, i + BATCH) })));
      }
      let swept: number;
      do swept = (await ctx.runMutation(internal.ingest.sweep, { feedId, startedAt })).swept;
      while (swept === SWEEP_BATCH);
      if (enrich.length > 0) await ctx.scheduler.runAfter(0, internal.normalize.enrich.run, { targets: enrich });
      const kept = items.filter((i) => i.event).length;
      await ctx.runMutation(internal.ingest.logFetch, { feedId, startedAt, status: "ok", rawCount: raws.length, insertedCount: kept });
      return { fetched: raws.length, kept };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const status = err instanceof RobotsDisallowedError ? "skipped_robots" : "error";
      await ctx.runMutation(internal.ingest.logFetch, { feedId, startedAt, status, rawCount: 0, insertedCount: 0, error });
      if (status === "skipped_robots") return { fetched: 0, kept: 0 };
      throw err;
    }
  },
});

export const RECRAWL_SOURCES = ["luma", "eventbrite", "mlh", "devpost"];

export const recrawl = internalMutation({
  args: { sources: v.optional(v.array(v.string())) },
  returns: v.array(v.string()),
  handler: async (ctx, { sources = RECRAWL_SOURCES }) => {
    const now = Date.now();
    const names: string[] = [];
    for (const source of sources) {
      const feeds = await ctx.db
        .query("feeds")
        .withIndex("by_source", (q) => q.eq("source", source))
        .take(500);
      for (const feed of feeds.filter((f) => f.enabled)) {
        await ctx.db.patch(feed._id, { nextFetchAt: now + feed.intervalMinutes * MINUTE });
        await ctx.scheduler.runAfter(0, internal.ingest.runFeed, { feedId: feed._id });
        names.push(feed.name);
      }
    }
    return names;
  },
});

export const runDue = internalMutation({
  args: { force: v.optional(v.boolean()), limit: v.optional(v.number()) },
  returns: v.array(v.string()),
  handler: async (ctx, { force, limit }) => {
    if (force) await ensureDefaults(ctx);
    const now = Date.now();
    const due = force
      ? (await ctx.db.query("feeds").collect()).filter((f) => f.enabled)
      : await selectDueFeeds(ctx, now, limit);
    for (const feed of due) {
      await ctx.db.patch(feed._id, { nextFetchAt: now + feed.intervalMinutes * MINUTE });
      await ctx.scheduler.runAfter(0, internal.ingest.runFeed, { feedId: feed._id });
    }
    return due.map((f) => f.name);
  },
});
