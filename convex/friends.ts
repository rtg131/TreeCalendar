import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { recordFor } from "./attendanceModel";
import { ensureFriendCode, friendFail, friendshipBetween, friendshipsOf, MAX_REQUESTS_PER_DAY, normalizeFriendCode, otherUserId } from "./lib/friends";
import { callerFor, requireCaller } from "./lib/identity";

const DAY = 86_400_000;
const person = { userId: v.id("users"), name: v.union(v.string(), v.null()), affiliation: v.union(v.string(), v.null()) };
const requestRow = v.object({ requestId: v.id("friendships"), ...person });

const profileOf = (user: Doc<"users">) => ({ userId: user._id, name: user.name ?? null, affiliation: user.affiliation ?? null });

export const myCode = mutation({
  args: { deviceId: v.string() },
  returns: v.object({ friendCode: v.string() }),
  handler: async (ctx, { deviceId }) => ({ friendCode: await ensureFriendCode(ctx, await requireCaller(ctx, deviceId)) }),
});

export const request = mutation({
  args: { deviceId: v.string(), friendCode: v.string() },
  returns: v.union(
    v.object({ status: v.literal("pending"), requestId: v.id("friendships") }),
    v.object({ status: v.literal("accepted"), friendUserId: v.id("users") }),
  ),
  handler: async (ctx, { deviceId, friendCode }) => {
    const user = await requireCaller(ctx, deviceId);
    const now = Date.now();
    const rate = await ctx.db.query("friend_request_rates").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
    const requests = (rate?.requests ?? []).filter((time) => time > now - DAY);
    if (requests.length >= MAX_REQUESTS_PER_DAY) friendFail("rate_limited", `You can send ${MAX_REQUESTS_PER_DAY} friend requests a day. Try again tomorrow.`);
    const code = normalizeFriendCode(friendCode);
    const target = code ? await ctx.db.query("users").withIndex("by_friend_code", (q) => q.eq("friendCode", code)).unique() : null;
    if (!target) return friendFail("invalid_code", "No one has that friend code");
    if (target._id === user._id) friendFail("self", "That's your own friend code");
    const existing = await friendshipBetween(ctx, user._id, target._id);
    if (existing?.status === "accepted") friendFail("already_friends", "You're already friends");
    if (existing?.requesterId === user._id) friendFail("already_requested", "You already sent this person a request");
    requests.push(now);
    if (rate) await ctx.db.patch(rate._id, { requests });
    else await ctx.db.insert("friend_request_rates", { userId: user._id, requests });
    if (existing) {
      await ctx.db.patch(existing._id, { status: "accepted", respondedAt: now });
      return { status: "accepted" as const, friendUserId: target._id };
    }
    const requestId = await ctx.db.insert("friendships", { requesterId: user._id, addresseeId: target._id, status: "pending", createdAt: now });
    return { status: "pending" as const, requestId };
  },
});

export const respond = mutation({
  args: { deviceId: v.string(), requestId: v.id("friendships"), accept: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { deviceId, requestId, accept }) => {
    const user = await requireCaller(ctx, deviceId);
    const row = await ctx.db.get(requestId);
    if (!row) return friendFail("not_found", "Friend request not found");
    if (row.addresseeId !== user._id) friendFail("forbidden", "Only the person who received this request can answer it");
    if (row.status !== "pending") friendFail("not_pending", "This request was already answered");
    if (accept) await ctx.db.patch(requestId, { status: "accepted", respondedAt: Date.now() });
    else await ctx.db.delete(requestId);
    return null;
  },
});

export const cancel = mutation({
  args: { deviceId: v.string(), requestId: v.id("friendships") },
  returns: v.null(),
  handler: async (ctx, { deviceId, requestId }) => {
    const user = await requireCaller(ctx, deviceId);
    const row = await ctx.db.get(requestId);
    if (!row) return friendFail("not_found", "Friend request not found");
    if (row.requesterId !== user._id) friendFail("forbidden", "Only the sender can cancel this request");
    if (row.status !== "pending") friendFail("not_pending", "This request was already accepted");
    await ctx.db.delete(requestId);
    return null;
  },
});

export const remove = mutation({
  args: { deviceId: v.string(), friendUserId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { deviceId, friendUserId }) => {
    const user = await requireCaller(ctx, deviceId);
    const row = await friendshipBetween(ctx, user._id, friendUserId);
    if (row?.status === "accepted") await ctx.db.delete(row._id);
    return null;
  },
});

async function acceptedFriends(ctx: QueryCtx, userId: Id<"users">) {
  const rows = (await friendshipsOf(ctx, userId)).filter((row) => row.status === "accepted");
  const users = await Promise.all(rows.map((row) => ctx.db.get(otherUserId(row, userId))));
  return users.filter((u) => u !== null);
}

const byName = (a: { name: string | null }, b: { name: string | null }) => (a.name ?? "").localeCompare(b.name ?? "");

export const list = query({
  args: { deviceId: v.string() },
  returns: v.object({ friends: v.array(v.object(person)), incoming: v.array(requestRow), outgoing: v.array(requestRow) }),
  handler: async (ctx, { deviceId }) => {
    const user = await callerFor(ctx, deviceId);
    const result = { friends: [] as ReturnType<typeof profileOf>[], incoming: [] as (ReturnType<typeof profileOf> & { requestId: Id<"friendships"> })[], outgoing: [] as (ReturnType<typeof profileOf> & { requestId: Id<"friendships"> })[] };
    if (!user) return result;
    for (const row of await friendshipsOf(ctx, user._id)) {
      const other = await ctx.db.get(otherUserId(row, user._id));
      if (!other) continue;
      if (row.status === "accepted") result.friends.push(profileOf(other));
      else (row.requesterId === user._id ? result.outgoing : result.incoming).push({ requestId: row._id, ...profileOf(other) });
    }
    result.friends.sort(byName);
    result.incoming.sort(byName);
    result.outgoing.sort(byName);
    return result;
  },
});

export const goingTo = query({
  args: { deviceId: v.string(), eventId: v.id("events") },
  returns: v.array(v.object({ userId: v.id("users"), name: v.union(v.string(), v.null()) })),
  handler: async (ctx, { deviceId, eventId }) => {
    const user = await callerFor(ctx, deviceId);
    if (!user) return [];
    const friends = await acceptedFriends(ctx, user._id);
    const records = await Promise.all(friends.map((friend) => recordFor(ctx, friend._id, eventId)));
    return friends
      .filter((_, i) => records[i]?.going === true || records[i]?.attended === true)
      .map((friend) => ({ userId: friend._id, name: friend.name ?? null }))
      .sort(byName);
  },
});
