import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { DEFAULT_FEEDS, RETIRED_DEFAULT_FEED_URLS } from "../adapters";
import type { NormalizedEvent } from "../normalize";
import { FUZZY_WINDOW_MS, dedupeKey, findDuplicate, mergeEvents, sourceOf, sourcesOf, unionSources, type EventSource } from "../normalize/dedupe";
import { isFixtureUrl } from "./fixtures";
import { INTERESTS } from "./interests";
import { scoutingFields } from "./scouting";
import type { RawEvent } from "./rawEvent";

export async function upsertRawListing(ctx: MutationCtx, raw: RawEvent, feedId?: Id<"feeds">) {
  const now = Date.now();
  const existing = await ctx.db
    .query("raw_listings")
    .withIndex("by_source_sourceId", (q) => q.eq("source", raw.source).eq("sourceId", raw.sourceId))
    .unique();
  if (existing) {
    await ctx.db.replace(existing._id, { feedId, source: raw.source, sourceId: raw.sourceId, raw, fetchedAt: now });
    return existing._id;
  }
  return ctx.db.insert("raw_listings", { feedId, source: raw.source, sourceId: raw.sourceId, raw, fetchedAt: now });
}

export function eventDoc(event: NormalizedEvent, sources: EventSource[], rawListingId?: Id<"raw_listings">) {
  const synthetic = isFixtureUrl(event.url) || sources.some((s) => isFixtureUrl(s.url) || isFixtureUrl(s.sourceId));
  return {
    ...event,
    ...scoutingFields(event),
    rawListingId,
    lastSeenAt: Date.now(),
    dedupeKey: dedupeKey(event),
    sources,
    ...(synthetic ? { synthetic } : {}),
  };
}

export function mergeInto(
  existing: Doc<"events">,
  event: NormalizedEvent,
  rawListingId?: Id<"raw_listings">,
  incoming: EventSource[] = [sourceOf(event)],
) {
  const sources = unionSources(sourcesOf(existing), incoming);
  const isPrimary = existing.source === event.source && existing.sourceId === event.sourceId;
  if (sources.length === 1) return eventDoc(event, sources, rawListingId ?? existing.rawListingId);
  const merged = isPrimary ? mergeEvents(event, existing) : mergeEvents(existing, event);
  return eventDoc(merged, sources, isPrimary ? (rawListingId ?? existing.rawListingId) : (existing.rawListingId ?? rawListingId));
}

export type UpsertResult = { id: Id<"events">; created: boolean; merged: boolean };

export async function upsertEvent(ctx: MutationCtx, event: NormalizedEvent, rawListingId?: Id<"raw_listings">): Promise<UpsertResult> {
  const existing = await findDuplicate(ctx, event);
  if (!existing) return { id: await ctx.db.insert("events", eventDoc(event, [sourceOf(event)], rawListingId)), created: true, merged: false };
  await ctx.db.replace(existing._id, mergeInto(existing, event, rawListingId));
  return { id: existing._id, created: false, merged: existing.source !== event.source || existing.sourceId !== event.sourceId };
}

export async function ensureDefaults(ctx: MutationCtx) {
  for (const feed of DEFAULT_FEEDS) {
    const existing = await ctx.db
      .query("feeds")
      .withIndex("by_url", (q) => q.eq("url", feed.url))
      .unique();
    if (!existing) await ctx.db.insert("feeds", { ...feed, enabled: feed.enabled ?? true });
  }
  for (const url of RETIRED_DEFAULT_FEED_URLS) {
    const retired = await ctx.db
      .query("feeds")
      .withIndex("by_url", (q) => q.eq("url", url))
      .collect();
    for (const row of retired.filter((r) => r.enabled)) await ctx.db.patch(row._id, { enabled: false });
  }
  for (const [order, interest] of INTERESTS.entries()) {
    const existing = await ctx.db
      .query("interests")
      .withIndex("by_slug", (q) => q.eq("slug", interest.id))
      .unique();
    const doc = { slug: interest.id, label: interest.label, emoji: interest.emoji, order };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("interests", doc);
  }
}

const listingFor = (ctx: MutationCtx, s: EventSource) =>
  ctx.db
    .query("raw_listings")
    .withIndex("by_source_sourceId", (q) => q.eq("source", s.source).eq("sourceId", s.sourceId))
    .unique();

async function eventsListing(ctx: MutationCtx, listing: Doc<"raw_listings">) {
  const start = Date.parse(listing.raw.startsAt);
  const nearby = Number.isNaN(start)
    ? []
    : await ctx.db
        .query("events")
        .withIndex("by_start", (q) => q.gte("startTime", start - FUZZY_WINDOW_MS).lte("startTime", start + FUZZY_WINDOW_MS))
        .take(500);
  const primary = await ctx.db
    .query("events")
    .withIndex("by_source_sourceId", (q) => q.eq("source", listing.source).eq("sourceId", listing.sourceId))
    .collect();
  const byId = new Map(primary.map((e) => [e._id, e]));
  for (const e of nearby) {
    if (sourcesOf(e).some((s) => s.source === listing.source && s.sourceId === listing.sourceId)) byId.set(e._id, e);
  }
  return [...byId.values()];
}

export async function markListingsGone(ctx: MutationCtx, listingIds: Id<"raw_listings">[]): Promise<number> {
  const now = Date.now();
  let hidden = 0;
  for (const listingId of listingIds) {
    const listing = await ctx.db.get(listingId);
    if (!listing) continue;
    if (listing.missingSince === undefined) await ctx.db.patch(listingId, { missingSince: now });
    for (const event of await eventsListing(ctx, listing)) {
      if (event.hiddenAt !== undefined) continue;
      let gone = true;
      for (const s of sourcesOf(event)) {
        if (s.source === listing.source && s.sourceId === listing.sourceId) continue;
        const other = await listingFor(ctx, s);
        if (!other || other.missingSince === undefined) gone = false;
      }
      if (!gone) continue;
      await ctx.db.patch(event._id, { hiddenAt: now });
      hidden++;
    }
  }
  return hidden;
}
