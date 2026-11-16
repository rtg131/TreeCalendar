import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type ActionCtx, type QueryCtx } from "../_generated/server";
import { isOnlineEventPage, ogImage, parseEventPage } from "../adapters/jsonld";
import { parseLumaPage } from "../adapters/luma";
import { RobotsDisallowedError, makeHttp } from "../lib/http";
import { httpsUrl } from "../lib/media";
import { isLive, scoutingFields } from "../lib/scouting";
import { markListingsGone } from "../lib/store";
import { eventPlace } from "../schema";
import { locate, type NormalizedEvent } from ".";
import { dedupeKey, pickEvent, sourcesOf } from "./dedupe";
import { nominatimGeocoder } from "./geocode";

export const MAX_ENRICH_FETCHES = 40;
export const MEDIA_BACKFILL_PAGE = 50;
export const MEDIA_BACKFILL_LOOKBACK_MS = 30 * 86_400_000;
export const NONE_TTL_MS = 3 * 86_400_000;
export const ERROR_TTL_MS = 6 * 3600_000;

const ENRICH_HOST = /(^|\.)(luma\.com|lu\.ma|meetup\.com)$/i;
const PLACEHOLDER_PLACE = /\b(register|sign in|log in|rsvp|approved|to see (the )?(address|location))\b|^(tba|tbd)$/i;

export type EventPlace = Infer<typeof eventPlace>;

export const enrichTarget = v.object({ url: v.string(), source: v.string(), sourceId: v.string() });
export type EnrichTarget = Infer<typeof enrichTarget>;

const pageStatus = v.union(v.literal("found"), v.literal("none"), v.literal("error"));

export function isEnrichable(url: string): boolean {
  try {
    return ENRICH_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export const needsPlace = (e: Pick<NormalizedEvent, "isOnline" | "lat" | "address">) => !e.isOnline && e.lat === undefined && !e.address;

type Media = Pick<NormalizedEvent, "imageUrl" | "organizerLogoUrl">;

export const needsMedia = (e: Media) => !e.imageUrl || !e.organizerLogoUrl;

export const needsFetch = (page: Doc<"event_pages"> | null, e: Media) => !page || (!page.mediaChecked && needsMedia(e));

export function mediaFrom(page: Doc<"event_pages">, e: Media): Media {
  const media: Media = {};
  if (!e.imageUrl && page.imageUrl) media.imageUrl = page.imageUrl;
  if (!e.organizerLogoUrl && page.organizerLogoUrl) media.organizerLogoUrl = page.organizerLogoUrl;
  return media;
}

const lumaHost = (url: string) => url.replace(/^(https?:\/\/)(www\.)?lu\.ma\//, "$1luma.com/");

export function pageMedia(html: string, url: string): Media {
  let luma: Media | undefined;
  try {
    const listed = parseLumaPage(html);
    luma = listed.find((e) => sameUrl(e.url, lumaHost(url))) ?? listed[0];
  } catch {
    luma = undefined;
  }
  const listed = parseEventPage(html, url);
  const ld = listed.find((e) => sameUrl(e.url, url)) ?? listed[0];
  const media: Media = {};
  const imageUrl = httpsUrl(luma?.imageUrl) ?? httpsUrl(ogImage(html)) ?? httpsUrl(ld?.imageUrl);
  const organizerLogoUrl = httpsUrl(luma?.organizerLogoUrl) ?? httpsUrl(ld?.organizerLogoUrl);
  if (imageUrl) media.imageUrl = imageUrl;
  if (organizerLogoUrl) media.organizerLogoUrl = organizerLogoUrl;
  return media;
}

export function isFresh(page: Doc<"event_pages">, now: number): boolean {
  if (page.status === "none") return now - page.fetchedAt < NONE_TTL_MS;
  if (page.status === "error") return now - page.fetchedAt < ERROR_TTL_MS;
  return true;
}

export async function readPage(ctx: Pick<QueryCtx, "db">, url: string) {
  const page = await ctx.db
    .query("event_pages")
    .withIndex("by_url", (q) => q.eq("url", url))
    .unique();
  return page && isFresh(page, Date.now()) ? page : null;
}

export const getPage = internalQuery({
  args: { url: v.string() },
  handler: (ctx, { url }) => readPage(ctx, url),
});

export const putPage = internalMutation({
  args: {
    url: v.string(),
    status: pageStatus,
    place: v.optional(eventPlace),
    outsideBayArea: v.optional(v.boolean()),
    imageUrl: v.optional(v.string()),
    organizerLogoUrl: v.optional(v.string()),
    mediaChecked: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, page) => {
    const row = { ...page, fetchedAt: Date.now() };
    const existing = await ctx.db
      .query("event_pages")
      .withIndex("by_url", (q) => q.eq("url", page.url))
      .unique();
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("event_pages", row);
    return null;
  },
});

const applied = v.object({ placed: v.boolean(), dropped: v.boolean(), media: v.boolean() });

export const apply = internalMutation({
  args: enrichTarget,
  returns: applied,
  handler: async (ctx, { url, source, sourceId }) => {
    const none = { placed: false, dropped: false, media: false };
    const page = await readPage(ctx, url);
    if (!page) return none;
    const event = await ctx.db
      .query("events")
      .withIndex("by_source_sourceId", (q) => q.eq("source", source).eq("sourceId", sourceId))
      .first();
    if (!event) return none;
    if (needsPlace(event) && page.outsideBayArea) {
      const listing = await ctx.db
        .query("raw_listings")
        .withIndex("by_source_sourceId", (q) => q.eq("source", source).eq("sourceId", sourceId))
        .unique();
      if (listing) await markListingsGone(ctx, [listing._id]);
      return { ...none, dropped: true };
    }
    const place = needsPlace(event) ? page.place : undefined;
    const media = mediaFrom(page, event);
    const hasMedia = Object.keys(media).length > 0;
    if (!place && !hasMedia) return none;
    if (!place) {
      await ctx.db.patch(event._id, media);
      return { ...none, media: true };
    }
    const updated = { ...pickEvent(event), ...place };
    await ctx.db.patch(event._id, { ...media, ...place, ...scoutingFields(updated), dedupeKey: dedupeKey(updated) });
    return { placed: true, dropped: false, media: hasMedia };
  },
});

const enrichCounts = v.object({ fetched: v.number(), placed: v.number(), dropped: v.number(), media: v.number(), deferred: v.number() });
type EnrichCounts = Infer<typeof enrichCounts>;

async function enrichTargets(ctx: ActionCtx, targets: EnrichTarget[], maxFetches: number): Promise<EnrichCounts> {
  const http = makeHttp(ctx);
  const geocode = nominatimGeocoder(ctx);
  const counts = { fetched: 0, placed: 0, dropped: 0, media: 0, deferred: 0 };
  const fetchedUrls = new Set<string>();

  const placeOf = async (html: string, url: string) => {
    const events = parseEventPage(html, url);
    const loc = (events.find((e) => sameUrl(e.url, url)) ?? events[0])?.location;
    if (!loc && isOnlineEventPage(html)) return { status: "found" as const, place: { city: "Online", isOnline: true } };
    if (!loc || loc.online) return { status: "none" as const };
    const name = loc.name && !PLACEHOLDER_PLACE.test(loc.name) ? loc.name : undefined;
    const address = loc.address && !PLACEHOLDER_PLACE.test(loc.address) ? loc.address : undefined;
    const located = await locate({ ...loc, name, address }, geocode);
    if (!located) return { status: "found" as const, outsideBayArea: true };
    if (located.lat === undefined && !address && !name) return { status: "none" as const };
    const place: EventPlace = { city: located.city };
    if (name) place.venue = name;
    if (address) place.address = address;
    if (located.lat !== undefined && located.lng !== undefined) Object.assign(place, { lat: located.lat, lng: located.lng });
    return { status: "found" as const, place };
  };

  const fetchPage = async (url: string) => {
    try {
      const html = await http.text(url, "text/html");
      return { url, ...(await placeOf(html, url)), ...pageMedia(html, url), mediaChecked: true };
    } catch (err) {
      const error = err instanceof RobotsDisallowedError ? "robots.txt disallows the page" : err instanceof Error ? err.message : String(err);
      return { url, status: "error" as const, error: error.slice(0, 300), mediaChecked: true };
    }
  };

  for (const target of targets) {
    const cached = await ctx.runQuery(internal.normalize.enrich.getPage, { url: target.url });
    if (!cached?.mediaChecked && !fetchedUrls.has(target.url)) {
      if (counts.fetched >= maxFetches) {
        counts.deferred++;
        continue;
      }
      fetchedUrls.add(target.url);
      counts.fetched++;
      await ctx.runMutation(internal.normalize.enrich.putPage, await fetchPage(target.url));
    }
    const outcome = await ctx.runMutation(internal.normalize.enrich.apply, target);
    if (outcome.placed) counts.placed++;
    if (outcome.dropped) counts.dropped++;
    if (outcome.media) counts.media++;
  }
  console.log(`enrich ${JSON.stringify(counts)}`);
  return counts;
}

export const run = internalAction({
  args: { targets: v.array(enrichTarget), maxFetches: v.optional(v.number()) },
  returns: enrichCounts,
  handler: (ctx, { targets, maxFetches = MAX_ENRICH_FETCHES }) => enrichTargets(ctx, targets, maxFetches),
});

export const mediaBackfillPage = internalQuery({
  args: { now: v.number(), cursor: v.union(v.string(), v.null()), numItems: v.number() },
  returns: v.object({ scanned: v.number(), targets: v.array(enrichTarget), continueCursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, { now, cursor, numItems }) => {
    const page = await ctx.db
      .query("events")
      .withIndex("by_start", (q) => q.gte("startTime", now - MEDIA_BACKFILL_LOOKBACK_MS))
      .paginate({ cursor, numItems });
    const targets: EnrichTarget[] = [];
    for (const e of page.page) {
      if (e.hiddenAt !== undefined || !isLive(e, now) || !needsMedia(e)) continue;
      const url = [e.url, ...sourcesOf(e).map((s) => s.url)].find(isEnrichable);
      if (url) targets.push({ url, source: e.source, sourceId: e.sourceId });
    }
    return { scanned: page.page.length, targets, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

export const backfillMedia = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    now: v.optional(v.number()),
    numItems: v.optional(v.number()),
    maxFetches: v.optional(v.number()),
  },
  returns: v.object({ scanned: v.number(), targets: v.number(), ...enrichCounts.fields, isDone: v.boolean() }),
  handler: async (ctx, args): Promise<{ scanned: number; targets: number; isDone: boolean } & EnrichCounts> => {
    const { cursor = null, now = Date.now(), numItems = MEDIA_BACKFILL_PAGE, maxFetches = MAX_ENRICH_FETCHES } = args;
    const page = await ctx.runQuery(internal.normalize.enrich.mediaBackfillPage, { now, cursor, numItems });
    const counts = await enrichTargets(ctx, page.targets, maxFetches);
    const next = counts.deferred > 0 ? cursor : page.isDone ? undefined : page.continueCursor;
    if (next !== undefined) await ctx.scheduler.runAfter(0, internal.normalize.enrich.backfillMedia, { cursor: next, now, numItems, maxFetches });
    return { scanned: page.scanned, targets: page.targets.length, ...counts, isDone: next === undefined };
  },
});

const coverage = v.object({ events: v.number(), banner: v.number(), logo: v.number() });

export const mediaCoverage = internalQuery({
  args: { now: v.optional(v.number()) },
  returns: v.object({ total: coverage, bySource: v.record(v.string(), coverage) }),
  handler: async (ctx, { now = Date.now() }) => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_start", (q) => q.gte("startTime", now - MEDIA_BACKFILL_LOOKBACK_MS))
      .take(8000);
    const total = { events: 0, banner: 0, logo: 0 };
    const bySource: Record<string, typeof total> = {};
    for (const e of events) {
      if (e.hiddenAt !== undefined || !isLive(e, now)) continue;
      for (const row of [total, (bySource[e.source] ??= { events: 0, banner: 0, logo: 0 })]) {
        row.events++;
        if (e.imageUrl) row.banner++;
        if (e.organizerLogoUrl) row.logo++;
      }
    }
    return { total, bySource };
  },
});

function sameUrl(a: string, b: string): boolean {
  const strip = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/$/, "");
  return strip(a) === strip(b);
}
