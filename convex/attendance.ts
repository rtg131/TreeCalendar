import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { hostCompany, hostCompanyFor } from "./lib/hostCompany";
import { ended, eventDoc, investors, MAX_COMMITMENTS, RATING_SCALE, recordFor, recordsFor, saveResponse, scaledRating, scaledRatingSum, userFor, writeGoing } from "./attendanceModel";

export const mine = query({
  args: { deviceId: v.string() },
  returns: v.array(v.object({
    eventId: v.id("events"), going: v.boolean(), attended: v.optional(v.boolean()),
    rating: v.optional(v.number()), investors: v.optional(investors), note: v.optional(v.string()),
  })),
  handler: async (ctx, { deviceId }) => {
    const user = await userFor(ctx, deviceId);
    if (!user) return [];
    return (await recordsFor(ctx, user._id)).map((record) => ({ ...record, rating: scaledRating(record) })).map(({ eventId, going, attended, rating, investors, note }) => ({
      eventId, going, ...(attended === undefined ? {} : { attended }),
      ...(rating === undefined ? {} : { rating }), ...(investors === undefined ? {} : { investors }),
      ...(note === undefined ? {} : { note }),
    }));
  },
});

export const setGoing = mutation({
  args: { deviceId: v.string(), eventId: v.id("events"), going: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { deviceId, eventId, going }) => {
    const user = await userFor(ctx, deviceId);
    if (!user) throw new Error("Finish onboarding before committing to events");
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error("Event not found");
    if (going && ended(event, Date.now())) throw new ConvexError({ code: "event_ended", message: "This event has already ended, so you can't mark it Going" });
    await writeGoing(ctx, user._id, eventId, going);
    return null;
  },
});

export const pending = query({
  args: { deviceId: v.string(), now: v.number() },
  returns: v.array(eventDoc),
  handler: async (ctx, { deviceId, now }) => {
    if (!Number.isFinite(now)) throw new Error("Invalid time");
    const user = await userFor(ctx, deviceId);
    if (!user) return [];
    const records = await ctx.db.query("attendance").withIndex("by_user_going", (q) => q.eq("userId", user._id).eq("going", true)).take(MAX_COMMITMENTS);
    const events = await Promise.all(records.filter((r) => r.attended === undefined && r.dismissedAt === undefined).map((r) => ctx.db.get(r.eventId)));
    return events.filter((e) => e !== null).filter((e) => ended(e, Math.min(now, Date.now()))).sort((a, b) => a.startTime - b.startTime);
  },
});

export const dismiss = mutation({
  args: { deviceId: v.string(), eventId: v.id("events") },
  returns: v.null(),
  handler: async (ctx, { deviceId, eventId }) => {
    const user = await userFor(ctx, deviceId);
    if (!user) throw new Error("Finish onboarding before dismissing events");
    const record = await recordFor(ctx, user._id, eventId);
    const event = await ctx.db.get(eventId);
    if (!record?.going || !event || !ended(event, Date.now())) throw new Error("An ended commitment is required");
    if (record.dismissedAt === undefined) await ctx.db.patch(record._id, { dismissedAt: Date.now() });
    return null;
  },
});

export const respond = mutation({
  args: {
    deviceId: v.string(), eventId: v.id("events"), attended: v.boolean(),
    rating: v.optional(v.number()), investors: v.optional(investors), note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { deviceId, eventId, ...response }) => {
    const user = await userFor(ctx, deviceId);
    if (!user) throw new Error("Finish onboarding before responding");
    const record = await recordFor(ctx, user._id, eventId);
    const event = await ctx.db.get(eventId);
    if (!record?.going || !event || !ended(event, Date.now())) throw new Error("An ended commitment is required");
    if (response.rating !== undefined && (!Number.isInteger(response.rating) || response.rating < 1 || response.rating > RATING_SCALE)) throw new Error("Rating must be an integer from 1 to 10");
    if (response.attended && (response.rating === undefined || response.investors === undefined)) throw new Error("Attendance requires a rating and investor response");
    if (!response.attended && (response.rating !== undefined || response.investors !== undefined)) throw new Error("Only attendees can rate or report investors");
    if (response.note !== undefined && (Array.from(response.note).length > 240 || /[\r\n\u0085\u2028\u2029]/u.test(response.note))) throw new Error("Note must be one line of at most 240 characters");
    await saveResponse(ctx, record, response);
    return null;
  },
});

export const history = query({
  args: { deviceId: v.string() },
  returns: v.array(v.object({ event: v.object({ ...eventDoc.fields, hostCompany: v.optional(hostCompany) }), rating: v.union(v.number(), v.null()), note: v.union(v.string(), v.null()), investors: v.union(investors, v.null()) })),
  handler: async (ctx, { deviceId }) => {
    const user = await userFor(ctx, deviceId);
    if (!user) return [];
    const records = await ctx.db.query("attendance").withIndex("by_user_attended", (q) => q.eq("userId", user._id).eq("attended", true)).take(MAX_COMMITMENTS);
    const rows = await Promise.all(records.map(async (r) => {
      const doc = await ctx.db.get(r.eventId);
      if (!doc) return null;
      const host = await hostCompanyFor(ctx, doc._id);
      const event = host ? { ...doc, hostCompany: host } : doc;
      return { event, rating: scaledRating(r) ?? null, note: r.note ?? null, investors: r.investors ?? null };
    }));
    return rows.filter((r) => r !== null).sort((a, b) => b.event.startTime - a.event.startTime);
  },
});

export const aggregate = query({
  args: { eventId: v.id("events") },
  returns: v.union(v.null(), v.object({ ratingCount: v.number(), averageWorthIt: v.number(), investorConfirmations: v.number(), ratingScale: v.literal(10) })),
  handler: async (ctx, { eventId }) => {
    const totals = await ctx.db.query("attendance_totals").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique();
    if (!totals || totals.ratingCount < 3) return null;
    return { ratingCount: totals.ratingCount, averageWorthIt: scaledRatingSum(totals) / totals.ratingCount, investorConfirmations: totals.investorConfirmations, ratingScale: RATING_SCALE };
  },
});

const MIGRATION_BATCH = 200;

export const migrateRatingsTo10 = internalMutation({
  args: {},
  returns: v.object({ attendance: v.number(), totals: v.number(), more: v.boolean() }),
  handler: async (ctx) => {
    const records = await ctx.db.query("attendance").withIndex("by_rating_scale", (q) => q.eq("ratingScale", undefined)).take(MIGRATION_BATCH);
    for (const record of records) await ctx.db.patch(record._id, { rating: scaledRating(record), ratingScale: RATING_SCALE });
    const totals = await ctx.db.query("attendance_totals").withIndex("by_rating_scale", (q) => q.eq("ratingScale", undefined)).take(MIGRATION_BATCH);
    for (const row of totals) await ctx.db.patch(row._id, { ratingSum: scaledRatingSum(row), ratingScale: RATING_SCALE });
    const more = records.length === MIGRATION_BATCH || totals.length === MIGRATION_BATCH;
    if (more) await ctx.scheduler.runAfter(0, internal.attendance.migrateRatingsTo10, {});
    return { attendance: records.length, totals: totals.length, more };
  },
});

export const goingForUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.array(eventDoc),
  handler: async (ctx, { userId }) => {
    const records = await ctx.db.query("attendance").withIndex("by_user_going", (q) => q.eq("userId", userId).eq("going", true)).take(MAX_COMMITMENTS);
    const events = await Promise.all(records.map((r) => ctx.db.get(r.eventId)));
    return events.filter((e) => e !== null);
  },
});
