import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, query } from "./_generated/server";
import { resolveAdapter } from "./adapters";
import { icalAdapter } from "./adapters/ical";
import { parseEventPage } from "./adapters/jsonld";
import type { Http } from "./lib/adapter";
import { RobotsDisallowedError, UnsafeUrlError, makeHttp } from "./lib/http";
import { rawEvent, type RawEvent } from "./lib/rawEvent";
import { upsertEvent, upsertRawListing } from "./lib/store";
import { normalize } from "./normalize";
import { embedderFromEnv } from "./normalize/embed";
import { nominatimGeocoder } from "./normalize/geocode";
import { normalizedEvent } from "./schema";

export const LINK_LIMIT_PER_HOUR = 10;
const HOUR = 3600_000;
const MAX_URL_LENGTH = 2048;

const resultStatus = v.union(v.literal("added"), v.literal("duplicate"), v.literal("needs_review"), v.literal("rejected"));
const submitResult = v.object({ status: resultStatus, eventIds: v.array(v.id("events")), reason: v.optional(v.string()) });

type SubmitResult = {
  status: "added" | "duplicate" | "needs_review" | "rejected";
  eventIds: Id<"events">[];
  reason?: string;
};

export function normalizeLinkUrl(input: string): { url: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return { error: "Invalid URL" };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { error: "Invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "Only http and https links are supported" };
  if (url.username || url.password) return { error: "Links with credentials are not supported" };
  if (url.port && url.port !== "80" && url.port !== "443") return { error: "Links on non-standard ports are not supported" };
  if (isPrivateHost(url.hostname)) return { error: "Private or local addresses are not allowed" };
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$)/i.test(key)) url.searchParams.delete(key);
  }
  return { url: url.toString() };
}

function linkUrlError(url: string): string | undefined {
  const checked = normalizeLinkUrl(url);
  return "error" in checked ? checked.error : undefined;
}

function isPrivateHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!name.includes(".") && !name.includes(":")) return true;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/.test(name)) return true;
  const v4 = name.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) return isPrivateV4(v4.slice(1).map(Number));
  if (name.includes(":")) {
    const mapped = name.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateHost(mapped[1]);
    if (/^::ffff:/.test(name)) return true;
    return name === "::" || name === "::1" || /^f[cd][0-9a-f]{0,2}:/.test(name) || /^fe[89ab][0-9a-f]?:/.test(name);
  }
  return false;
}

function isPrivateV4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isFeedUrl(url: string): boolean {
  const { hostname, pathname } = new URL(url);
  if (/\.ics$/i.test(pathname)) return true;
  return /(^|\.)(lu\.ma|luma\.com)$/i.test(hostname) && /^\/ics(\/|$)/i.test(pathname);
}

async function discover(url: string, http: Http): Promise<RawEvent[]> {
  const feed = { source: "link", name: url, url };
  if (isFeedUrl(url)) return icalAdapter.fetch({ ...feed, source: "ical" }, http);
  const fromJsonLd = parseEventPage(await http.text(url, "text/html"), url);
  if (fromJsonLd.length > 0) return fromJsonLd;
  const extractor = resolveAdapter({ source: feed.source, tier: "extraction" });
  return extractor ? extractor.fetch(feed, http) : [];
}

export const begin = internalMutation({
  args: { deviceId: v.string(), url: v.string(), error: v.optional(v.string()) },
  returns: v.object({ submissionId: v.id("link_submissions"), limited: v.boolean() }),
  handler: async (ctx, { deviceId, url, error }) => {
    const now = Date.now();
    const recent = await ctx.db
      .query("link_submissions")
      .withIndex("by_device", (q) => q.eq("deviceId", deviceId).gt("createdAt", now - HOUR))
      .take(LINK_LIMIT_PER_HOUR);
    const limited = recent.length >= LINK_LIMIT_PER_HOUR;
    const reason = limited ? `Limit of ${LINK_LIMIT_PER_HOUR} links per hour reached` : error;
    const submissionId = await ctx.db.insert("link_submissions", {
      deviceId,
      url,
      status: reason ? "rejected" : "pending",
      eventIds: [],
      error: reason,
      createdAt: now,
    });
    return { submissionId, limited };
  },
});

export const store = internalMutation({
  args: {
    submissionId: v.id("link_submissions"),
    items: v.array(v.object({ raw: rawEvent, event: v.union(normalizedEvent, v.null()) })),
  },
  returns: submitResult,
  handler: async (ctx, { submissionId, items }) => {
    const eventIds: Id<"events">[] = [];
    let added = 0;
    for (const { raw, event } of items) {
      const rawListingId = await upsertRawListing(ctx, raw);
      if (!event) continue;
      const { id, created } = await upsertEvent(ctx, event, rawListingId);
      if (created) added++;
      if (!eventIds.includes(id)) eventIds.push(id);
    }
    const result: SubmitResult =
      eventIds.length === 0
        ? { status: "rejected", eventIds, reason: "No upcoming Bay Area events matched this link" }
        : { status: added > 0 ? "added" : "duplicate", eventIds };
    await ctx.db.patch(submissionId, { status: result.status, eventIds, error: result.reason });
    return result;
  },
});

export const finish = internalMutation({
  args: {
    submissionId: v.id("link_submissions"),
    status: v.union(v.literal("needs_review"), v.literal("rejected")),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { submissionId, status, error }) => {
    await ctx.db.patch(submissionId, { status, error });
    return null;
  },
});

export const submit = action({
  args: { deviceId: v.string(), url: v.string() },
  returns: submitResult,
  handler: async (ctx, args): Promise<SubmitResult> => {
    const normalized = normalizeLinkUrl(args.url);
    const url = "url" in normalized ? normalized.url : args.url.trim().slice(0, MAX_URL_LENGTH);
    const error = "error" in normalized ? normalized.error : undefined;
    const { submissionId, limited } = await ctx.runMutation(internal.links.begin, { deviceId: args.deviceId, url, error });
    if (limited) return { status: "rejected", eventIds: [], reason: `Limit of ${LINK_LIMIT_PER_HOUR} links per hour reached` };
    if (error) return { status: "rejected", eventIds: [], reason: error };

    const fail = async (status: "needs_review" | "rejected", reason: string): Promise<SubmitResult> => {
      await ctx.runMutation(internal.links.finish, { submissionId, status, error: reason });
      return { status, eventIds: [], reason };
    };

    let raws: RawEvent[];
    try {
      raws = await discover(url, makeHttp(ctx, { validateUrl: linkUrlError }));
    } catch (err) {
      if (err instanceof RobotsDisallowedError) return fail("rejected", "The site's robots.txt does not allow fetching this page");
      if (err instanceof UnsafeUrlError) return fail("rejected", "The link redirects to an address that is not allowed");
      return fail("needs_review", `Could not read the link: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (raws.length === 0) return fail("needs_review", "No event details found on the page");

    const now = Date.now();
    const geocode = nominatimGeocoder(ctx);
    const items = await Promise.all(
      raws.map(async (raw) => {
        const event = await normalize(raw, { geocode });
        return { raw, event: event && (event.endTime ?? event.startTime) >= now ? event : null };
      }),
    );
    await embedderFromEnv()?.embed(items.flatMap((i) => (i.event ? [i.event] : [])));
    return ctx.runMutation(internal.links.store, { submissionId, items });
  },
});

export const mine = query({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) =>
    ctx.db
      .query("link_submissions")
      .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
      .order("desc")
      .take(50),
});
