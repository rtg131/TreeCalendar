import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { foldText } from "../lib/geo";
import { toZonedIso } from "../lib/time";
import { eventFields } from "../schema";
import type { NormalizedEvent } from ".";

export type EventSource = { url: string; source: string; sourceId: string };

export const DEDUPE_TIMEZONE = "America/Los_Angeles";
export const FUZZY_WINDOW_MS = 2 * 3600_000;
export const TITLE_SIMILARITY_MIN = 0.85;

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "at", "in", "on", "for", "with", "by", "to", "from", "x", "vs", "presents", "hosted", "event",
]);

export function normalizeTitle(title: string): string {
  return foldText(title.replace(/&/g, " and "))
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w))
    .join(" ");
}

const placeOf = (e: Pick<NormalizedEvent, "isOnline" | "city" | "venue">) =>
  e.isOnline ? "online" : foldText(e.city || e.venue || "");

export function dedupeKey(e: NormalizedEvent): string {
  return [normalizeTitle(e.title), toZonedIso(e.startTime, DEDUPE_TIMEZONE).slice(0, 13), placeOf(e)].join("|");
}

const bigrams = (s: string) => {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1);
  return out;
};

export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  const numbers = (s: string) => s.split(" ").filter((w) => /\d/.test(w)).join(" ");
  if (numbers(na) !== numbers(nb)) return 0;
  const sa = na.replace(/ /g, "");
  const sb = nb.replace(/ /g, "");
  if (sa === sb) return 1;
  if (sa.length < 2 || sb.length < 2) return 0;
  const ga = bigrams(sa);
  const gb = bigrams(sb);
  let shared = 0;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  return (2 * shared) / (sa.length - 1 + (sb.length - 1));
}

export const sourceOf = (e: NormalizedEvent): EventSource => ({ url: e.url, source: e.source, sourceId: e.sourceId });

export const sourcesOf = (e: NormalizedEvent & { sources?: EventSource[] }): EventSource[] => e.sources ?? [sourceOf(e)];

export function unionSources(a: EventSource[], b: EventSource[]): EventSource[] {
  const out = [...a];
  for (const s of b) if (!out.some((o) => o.source === s.source && o.sourceId === s.sourceId)) out.push(s);
  return out;
}

const hasSource = (doc: Doc<"events">, s: EventSource) => sourcesOf(doc).some((o) => o.source === s.source && o.sourceId === s.sourceId);

const conflictsWithSource = (doc: Doc<"events">, s: EventSource) =>
  sourcesOf(doc).some((o) => o.source === s.source && o.sourceId !== s.sourceId);

export async function findDuplicate(ctx: Pick<QueryCtx, "db">, event: NormalizedEvent, exclude?: Id<"events">): Promise<Doc<"events"> | null> {
  const self = sourceOf(event);
  const primary = await ctx.db
    .query("events")
    .withIndex("by_source_sourceId", (q) => q.eq("source", event.source).eq("sourceId", event.sourceId))
    .take(2);
  const own = primary.find((d) => d._id !== exclude);
  if (own) return own;

  const candidate = (d: Doc<"events">) => d._id !== exclude && !conflictsWithSource(d, self);
  const keyed = await ctx.db
    .query("events")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey(event)))
    .take(20);
  const window = await ctx.db
    .query("events")
    .withIndex("by_start", (q) => q.gte("startTime", event.startTime - FUZZY_WINDOW_MS).lte("startTime", event.startTime + FUZZY_WINDOW_MS))
    .take(500);
  const listed = [...keyed, ...window].find((d) => d._id !== exclude && hasSource(d, self));
  if (listed) return listed;

  const exact = keyed.find((d) => candidate(d) || (d._id !== exclude && d.startTime === event.startTime));
  if (exact) return exact;

  const nearby = window.filter(candidate);
  const place = placeOf(event);
  if (!place) return null;
  let best: { doc: Doc<"events">; score: number } | null = null;
  for (const doc of nearby) {
    if (placeOf(doc) !== place) continue;
    const score = titleSimilarity(doc.title, event.title);
    if (score >= TITLE_SIMILARITY_MIN && (!best || score > best.score)) best = { doc, score };
  }
  return best?.doc ?? null;
}

const richer = (a: string | undefined, b: string | undefined) => (b && (!a || b.length > a.length) ? b : a);
const union = <T>(a: T[], b: T[]) => [...new Set([...a, ...b])];

export function pickEvent(doc: NormalizedEvent): NormalizedEvent {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(eventFields) as (keyof NormalizedEvent)[]) if (doc[key] !== undefined) out[key] = doc[key];
  return out as NormalizedEvent;
}

export function mergeEvents(primary: NormalizedEvent, other: NormalizedEvent): NormalizedEvent {
  const coords = primary.lat !== undefined && primary.lng !== undefined ? primary : other;
  const audience = union(primary.audience, other.audience);
  return pickEvent({
    title: primary.title,
    description: richer(primary.description, other.description) ?? "",
    startTime: primary.startTime,
    endTime: primary.endTime ?? other.endTime,
    timezone: primary.timezone === "UTC" ? other.timezone : primary.timezone,
    venue: richer(primary.venue, other.venue),
    address: richer(primary.address, other.address),
    lat: coords.lat,
    lng: coords.lng,
    city: primary.city && !(primary.isOnline && !other.isOnline) ? primary.city : other.city || primary.city,
    isOnline: primary.isOnline && other.isOnline,
    url: primary.url,
    imageUrl: primary.imageUrl ?? other.imageUrl,
    organizerLogoUrl: primary.organizerLogoUrl ?? other.organizerLogoUrl,
    source: primary.source,
    sourceId: primary.sourceId,
    organizer: richer(primary.organizer, other.organizer),
    hosts: union(primary.hosts, other.hosts),
    tags: union(primary.tags, other.tags),
    eventType: primary.eventType !== "other" ? primary.eventType : other.eventType,
    audience: audience.length > 1 ? audience.filter((a) => a !== "general") : audience,
    investorScore: Math.max(primary.investorScore, other.investorScore),
    investorSignals: union(primary.investorSignals, other.investorSignals),
  });
}
