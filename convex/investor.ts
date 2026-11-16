import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, query } from "./_generated/server";
import { STUDENT_DENSITY_MIN, isLive, scout, scoutingFields, type Scouting } from "./lib/scouting";
import { eventType } from "./schema";

const DAY = 86_400_000;
const CANDIDATES = 800;
const LIMIT = 60;
const BACKFILL_BATCH = 200;

export type InvestorEvent = Omit<Doc<"events">, "school" | "studentDensity"> & Scouting;

export const ranked = query({
  args: {
    deviceId: v.string(),
    school: v.optional(v.string()),
    eventType: v.optional(eventType),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ events: InvestorEvent[] }> => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .unique();
    if (!user) return { events: [] };
    const now = Date.now();
    const from = args.from ?? now - 60 * DAY;
    const to = args.to ?? now + 90 * DAY;
    const school = args.school;
    const candidates = school
      ? await ctx.db
          .query("events")
          .withIndex("by_school_start", (q) => q.eq("school", school).gte("startTime", from).lte("startTime", to))
          .take(CANDIDATES)
      : await ctx.db
          .query("events")
          .withIndex("by_start", (q) => q.gte("startTime", from).lte("startTime", to))
          .take(CANDIDATES);
    const events = candidates
      .filter((e) => !e.synthetic && e.hiddenAt === undefined && isLive(e, now) && (args.eventType === undefined || e.eventType === args.eventType))
      .map((e): InvestorEvent => ({ ...e, ...scout(e, now) }))
      .filter((e) => e.studentDensity >= STUDENT_DENSITY_MIN)
      .sort((a, b) => b.scoutScore - a.scoutScore || a.startTime - b.startTime)
      .slice(0, LIMIT);
    return { events };
  },
});

export const backfillScouting = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ updated: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("events").paginate({ cursor: cursor ?? null, numItems: BACKFILL_BATCH });
    let updated = 0;
    for (const event of page.page) {
      const fields = scoutingFields(event);
      if (event.school === fields.school && event.studentDensity === fields.studentDensity) continue;
      await ctx.db.patch(event._id, { school: fields.school, studentDensity: fields.studentDensity });
      updated++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.investor.backfillScouting, { cursor: page.continueCursor });
    }
    return { updated, isDone: page.isDone };
  },
});
