import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import schema from "./schema";

export const investors = v.union(v.literal("yes"), v.literal("no"), v.literal("unsure"));
export const eventDoc = v.object({
  ...schema.tables.events.validator.fields,
  _id: v.id("events"),
  _creationTime: v.number(),
});
export const MAX_COMMITMENTS = 1000;
export const RATING_SCALE = 10 as const;

export const scaledRating = (r: { rating?: number; ratingScale?: number }) =>
  r.rating === undefined || r.ratingScale === RATING_SCALE ? r.rating : r.rating * 2;
export const scaledRatingSum = (t: { ratingSum: number; ratingScale?: number }) =>
  t.ratingScale === RATING_SCALE ? t.ratingSum : t.ratingSum * 2;

export const userFor = (ctx: QueryCtx, deviceId: string) =>
  ctx.db.query("users").withIndex("by_device", (q) => q.eq("deviceId", deviceId)).unique();

export const recordFor = (ctx: QueryCtx, userId: Id<"users">, eventId: Id<"events">) =>
  ctx.db.query("attendance").withIndex("by_user_event", (q) => q.eq("userId", userId).eq("eventId", eventId)).unique();

export async function ensureUser(ctx: MutationCtx, deviceId: string) {
  const existing = await userFor(ctx, deviceId);
  if (existing) return existing._id;
  return ctx.db.insert("users", {
    deviceId, role: "student", interests: ["ai", "startups"], city: "San Francisco",
    lat: 37.7749, lng: -122.4194, locationSource: "city", updatedAt: Date.now(),
  });
}

export async function writeGoing(ctx: MutationCtx, userId: Id<"users">, eventId: Id<"events">, going: boolean) {
  const existing = await recordFor(ctx, userId, eventId);
  if (existing) {
    if (existing.going !== going) await ctx.db.patch(existing._id, { going });
    return existing._id;
  }
  if (!going) return null;
  if ((await recordsFor(ctx, userId)).length >= MAX_COMMITMENTS) throw new Error("Attendance limit exceeded");
  return ctx.db.insert("attendance", { userId, eventId, going });
}

export async function recordsFor(ctx: QueryCtx, userId: Id<"users">) {
  const records = await ctx.db.query("attendance").withIndex("by_user_event", (q) => q.eq("userId", userId)).take(MAX_COMMITMENTS + 1);
  if (records.length > MAX_COMMITMENTS) throw new Error("Attendance limit exceeded");
  return records;
}

export const ended = (event: Doc<"events">, now: number) =>
  (event.endTime ?? event.startTime + 3 * 3_600_000) <= now;

export async function saveResponse(
  ctx: MutationCtx,
  record: Doc<"attendance">,
  response: { attended: boolean; rating?: number; investors?: "yes" | "no" | "unsure"; note?: string },
) {
  const totals = await ctx.db.query("attendance_totals").withIndex("by_event", (q) => q.eq("eventId", record.eventId)).unique();
  const values = {
    eventId: record.eventId,
    ratingCount: (totals?.ratingCount ?? 0) + Number(response.rating !== undefined) - Number(record.rating !== undefined),
    ratingSum: (totals ? scaledRatingSum(totals) : 0) + (response.rating ?? 0) - (scaledRating(record) ?? 0),
    investorConfirmations: (totals?.investorConfirmations ?? 0) + Number(response.investors === "yes") - Number(record.investors === "yes"),
    ratingScale: RATING_SCALE,
  };
  if (totals) await ctx.db.patch(totals._id, values);
  else await ctx.db.insert("attendance_totals", values);
  await ctx.db.patch(record._id, {
    attended: response.attended,
    rating: response.rating,
    investors: response.investors,
    note: response.note,
    ratingScale: RATING_SCALE,
  });
}
