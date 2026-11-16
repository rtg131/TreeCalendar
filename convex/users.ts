import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { CONTACT_FIELDS, checkContactField } from "./lib/contact";
import { PROFILE_FIELDS, checkProfileField } from "./lib/profile";
import { role } from "./schema";

export const get = query({
  args: { deviceId: v.string() },
  handler: (ctx, { deviceId }) =>
    ctx.db
      .query("users")
      .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
      .unique(),
});

export const upsert = mutation({
  args: {
    deviceId: v.string(),
    role,
    interests: v.array(v.string()),
    city: v.string(),
    lat: v.number(),
    lng: v.number(),
    locationSource: v.union(v.literal("device"), v.literal("city")),
    radiusKm: v.optional(v.number()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    affiliation: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    priorRoles: v.optional(v.string()),
    experience: v.optional(v.string()),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .unique();
    const doc = {
      ...args, radiusKm: args.radiusKm ?? existing?.radiusKm, updatedAt: Date.now(),
      workEmail: existing?.workEmail, workDomain: existing?.workDomain,
      workEmailVerifiedAt: existing?.workEmailVerifiedAt, workEmailVerifiedVia: existing?.workEmailVerifiedVia,
      friendCode: existing?.friendCode,
    };
    for (const field of CONTACT_FIELDS) {
      const raw = args[field];
      if (raw === undefined) {
        doc[field] = existing?.[field];
        continue;
      }
      const result = checkContactField(field, raw);
      if ("error" in result) throw new ConvexError({ field, message: result.error });
      if (field === "email" && existing && result.value !== existing.email && (await hasAccount(ctx, existing._id))) {
        throw new ConvexError({ field, message: "Your email is how you sign in, so it can't be changed yet" });
      }
      doc[field] = result.value || undefined;
    }
    for (const field of PROFILE_FIELDS) {
      const raw = args[field];
      if (raw === undefined) {
        doc[field] = existing?.[field];
        continue;
      }
      const result = checkProfileField(field, raw);
      if ("error" in result) throw new ConvexError({ field, message: result.error });
      doc[field] = result.value || undefined;
    }
    if (existing) {
      await ctx.db.replace(existing._id, doc);
      return existing._id;
    }
    return ctx.db.insert("users", doc);
  },
});

const hasAccount = async (ctx: QueryCtx, userId: Id<"users">) =>
  (await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
    .first()) !== null;

export const accountDeviceId = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const [userId, sessionId] = await Promise.all([getAuthUserId(ctx), getAuthSessionId(ctx)]);
    if (!userId || !sessionId) return null;
    const session = await ctx.db.get(sessionId);
    if (!session || session.userId !== userId || session.expirationTime < Date.now()) return null;
    return (await ctx.db.get(userId))?.deviceId ?? null;
  },
});
