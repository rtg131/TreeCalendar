import { v } from "convex/values";
import { internalMutation, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { briefingValue, cleanRecipient, fingerprint, followupValue, templateBriefing } from "./prepContent";
import type { Briefing, Followup } from "./prepContent";

export const prepArgs = { deviceId: v.string(), eventId: v.id("events") };
export const kindValue = v.union(v.literal("briefing"), v.literal("followup"));
export type PrepArgs = { deviceId: string; eventId: Id<"events"> };
export type PrepareArgs = PrepArgs & { kind: "briefing" | "followup"; recipient?: string };
export type Prepared = { event: Doc<"events">; fingerprint: string; briefing: Briefing | null; followup: Followup | null };

export async function load(ctx: QueryCtx, args: PrepArgs) {
  const user = await ctx.db.query("users").withIndex("by_device", (q) => q.eq("deviceId", args.deviceId)).unique();
  if (!user) throw new Error("Complete onboarding before generating prep cards");
  const event = await ctx.db.get(args.eventId);
  if (!event) throw new Error("Event not found");
  const currentFingerprint = fingerprint(event);
  const briefing = await ctx.db.query("prep_briefings").withIndex("by_event", (q) => q.eq("eventId", event._id)).unique();
  const followup = await ctx.db.query("prep_followups").withIndex("by_user_event", (q) => q.eq("userId", user._id).eq("eventId", event._id)).unique();
  return {
    user, event, fingerprint: currentFingerprint,
    briefing: briefing?.fingerprint === currentFingerprint ? briefing.value : null,
    followup: followup?.fingerprint === currentFingerprint ? followup.value : null,
  };
}

export const prepare = internalMutation({
  args: { ...prepArgs, kind: kindValue, recipient: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Prepared> => {
    const recipient = args.kind === "followup" ? cleanRecipient(args.recipient ?? "") : undefined;
    const data = await load(ctx, args);
    const result = { event: data.event, fingerprint: data.fingerprint, briefing: data.briefing, followup: data.followup };
    if (args.kind === "briefing" ? data.briefing : data.followup?.recipient === recipient) return result;
    const now = Date.now();
    const rate = await ctx.db.query("prep_rates").withIndex("by_user", (q) => q.eq("userId", data.user._id)).unique();
    const requests = (rate?.requests ?? []).filter((time) => time > now - 60_000);
    if (requests.length >= 6) throw new Error("Prep rate limit reached. Try again in one minute.");
    requests.push(now);
    if (rate) await ctx.db.patch(rate._id, { requests });
    else await ctx.db.insert("prep_rates", { userId: data.user._id, requests });
    return result;
  },
});

export type StoreArgs = PrepArgs & { fingerprint: string; value: Briefing | Followup };
export const store = internalMutation({
  args: { ...prepArgs, fingerprint: v.string(), value: v.union(briefingValue, followupValue) },
  handler: async (ctx, args) => {
    const data = await load(ctx, args);
    if (args.fingerprint !== data.fingerprint) throw new Error("Event changed. Generate the prep card again.");
    if ("summary" in args.value) {
      const existing = await ctx.db.query("prep_briefings").withIndex("by_event", (q) => q.eq("eventId", args.eventId)).unique();
      const doc = { eventId: args.eventId, fingerprint: args.fingerprint, value: args.value };
      if (existing) await ctx.db.replace(existing._id, doc);
      else await ctx.db.insert("prep_briefings", doc);
    } else {
      const existing = await ctx.db.query("prep_followups").withIndex("by_user_event", (q) => q.eq("userId", data.user._id).eq("eventId", args.eventId)).unique();
      const doc = { userId: data.user._id, eventId: args.eventId, fingerprint: args.fingerprint, value: args.value };
      if (existing) await ctx.db.replace(existing._id, doc);
      else await ctx.db.insert("prep_followups", doc);
    }
    return null;
  },
});

export const preGenerateSeed = internalMutation({
  args: {},
  returns: v.object({ generated: v.number() }),
  handler: async (ctx) => {
    const events = await ctx.db.query("events").withIndex("by_source_sourceId", (q) => q.eq("source", "seed")).collect();
    let generated = 0;
    for (const event of events) {
      const currentFingerprint = fingerprint(event);
      const existing = await ctx.db.query("prep_briefings").withIndex("by_event", (q) => q.eq("eventId", event._id)).unique();
      if (existing?.fingerprint === currentFingerprint) continue;
      const doc = { eventId: event._id, fingerprint: currentFingerprint, value: templateBriefing(event) };
      if (existing) await ctx.db.replace(existing._id, doc);
      else await ctx.db.insert("prep_briefings", doc);
      generated++;
    }
    return { generated };
  },
});
