import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { withHostCompanies } from "./lib/hostCompany";

const userFor = (ctx: QueryCtx, deviceId: string) =>
  ctx.db
    .query("users")
    .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
    .unique();

export const toggle = mutation({
  args: { deviceId: v.string(), eventId: v.id("events") },
  returns: v.boolean(),
  handler: async (ctx, { deviceId, eventId }) => {
    const user = await userFor(ctx, deviceId);
    if (!user) throw new Error("Finish onboarding before saving events");
    const existing = await ctx.db
      .query("saves")
      .withIndex("by_user_event", (q) => q.eq("userId", user._id).eq("eventId", eventId))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      return false;
    }
    await ctx.db.insert("saves", { userId: user._id, eventId, savedAt: Date.now() });
    return true;
  },
});

export const isSaved = query({
  args: { deviceId: v.string(), eventId: v.id("events") },
  returns: v.boolean(),
  handler: async (ctx, { deviceId, eventId }) => {
    const user = await userFor(ctx, deviceId);
    if (!user) return false;
    const existing = await ctx.db
      .query("saves")
      .withIndex("by_user_event", (q) => q.eq("userId", user._id).eq("eventId", eventId))
      .unique();
    return existing !== null;
  },
});

export const list = query({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    const user = await userFor(ctx, deviceId);
    if (!user) return [];
    const saves = await ctx.db
      .query("saves")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(100);
    const events = await Promise.all(saves.map((s) => ctx.db.get(s.eventId)));
    return withHostCompanies(ctx, events.filter((e) => e !== null).sort((a, b) => a.startTime - b.startTime));
  },
});
