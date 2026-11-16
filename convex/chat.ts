import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireCaller, requireHost } from "./lib/identity";
import { cleanText, fail, MAX_BODY, requireVerified, sideOf } from "./lib/connections";

const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;

export async function nextMessageTime(ctx: QueryCtx, connectionId: Id<"connections">) {
  const last = await ctx.db.query("messages").withIndex("by_connection", (q) => q.eq("connectionId", connectionId)).order("desc").first();
  return Math.max(Date.now(), (last?.createdAt ?? 0) + 1);
}

async function openChat(ctx: QueryCtx, deviceId: string, connectionId: Id<"connections">) {
  const user = await requireCaller(ctx, deviceId);
  const connection = await ctx.db.get(connectionId);
  const side = connection ? await sideOf(ctx, connection, user._id) : null;
  if (!connection || !side) return fail("not_found", "Connection not found");
  if (side === "company") requireHost(user);
  if (connection.status !== "accepted") fail("forbidden", "Chat opens once the connection is accepted");
  return { user, connection };
}

export const send = mutation({
  args: { deviceId: v.string(), connectionId: v.id("connections"), body: v.string() },
  returns: v.id("messages"),
  handler: async (ctx, { deviceId, connectionId, body }) => {
    const { user, connection } = await openChat(ctx, deviceId, connectionId);
    await requireVerified(ctx, connection.companyId);
    const text = cleanText(body, MAX_BODY, "Message");
    if (!text) return fail("invalid", "Message is empty");
    return ctx.db.insert("messages", { connectionId, senderUserId: user._id, body: text, createdAt: await nextMessageTime(ctx, connectionId) });
  },
});

export const list = query({
  args: { deviceId: v.string(), connectionId: v.id("connections"), before: v.optional(v.number()), limit: v.optional(v.number()) },
  returns: v.object({
    messages: v.array(v.object({
      _id: v.id("messages"), body: v.string(), createdAt: v.number(),
      mine: v.boolean(), fromTalent: v.boolean(), senderName: v.union(v.string(), v.null()),
    })),
    nextBefore: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, { deviceId, connectionId, before, limit }) => {
    const { user, connection } = await openChat(ctx, deviceId, connectionId);
    const size = limit === undefined ? DEFAULT_PAGE : Number.isInteger(limit) && limit >= 1 && limit <= MAX_PAGE ? limit : fail("invalid", `limit must be an integer from 1 to ${MAX_PAGE}`);
    if (before !== undefined && !Number.isFinite(before)) fail("invalid", "before must be a timestamp");
    const page = await ctx.db.query("messages")
      .withIndex("by_connection", (q) => before === undefined ? q.eq("connectionId", connectionId) : q.eq("connectionId", connectionId).lt("createdAt", before))
      .order("desc").take(size + 1);
    const more = page.length > size;
    const rows = page.slice(0, size).reverse();
    const names = new Map<Id<"users">, string | null>();
    for (const row of rows) if (!names.has(row.senderUserId)) names.set(row.senderUserId, (await ctx.db.get(row.senderUserId))?.name ?? null);
    return {
      messages: rows.map((m) => ({
        _id: m._id, body: m.body, createdAt: m.createdAt, mine: m.senderUserId === user._id,
        fromTalent: m.senderUserId === connection.talentUserId, senderName: names.get(m.senderUserId) ?? null,
      })),
      nextBefore: more ? rows[0].createdAt : null,
    };
  },
});
