import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const MAX_FRIENDSHIPS = 1000;
export const MAX_REQUESTS_PER_DAY = 30;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export type FriendErrorCode = "invalid_code" | "self" | "already_friends" | "already_requested" | "rate_limited" | "forbidden" | "not_found" | "not_pending";

export const friendFail = (code: FriendErrorCode, message: string): never => {
  throw new ConvexError({ code, message });
};

export const normalizeFriendCode = (raw: string) => {
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z0-9]{6,8}$/.test(code) ? code : null;
};

export async function friendshipBetween(ctx: QueryCtx, a: Id<"users">, b: Id<"users">) {
  return await ctx.db.query("friendships").withIndex("by_pair", (q) => q.eq("requesterId", a).eq("addresseeId", b)).unique()
    ?? await ctx.db.query("friendships").withIndex("by_pair", (q) => q.eq("requesterId", b).eq("addresseeId", a)).unique();
}

export async function friendshipsOf(ctx: QueryCtx, userId: Id<"users">) {
  const [outgoing, incoming] = await Promise.all([
    ctx.db.query("friendships").withIndex("by_pair", (q) => q.eq("requesterId", userId)).take(MAX_FRIENDSHIPS),
    ctx.db.query("friendships").withIndex("by_addressee", (q) => q.eq("addresseeId", userId)).take(MAX_FRIENDSHIPS),
  ]);
  return [...outgoing, ...incoming];
}

export const otherUserId = (row: Doc<"friendships">, userId: Id<"users">) => row.requesterId === userId ? row.addresseeId : row.requesterId;

export async function deleteFriendshipsOf(ctx: MutationCtx, userId: Id<"users">) {
  for (const row of await friendshipsOf(ctx, userId)) await ctx.db.delete(row._id);
  const rate = await ctx.db.query("friend_request_rates").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  if (rate) await ctx.db.delete(rate._id);
}

export async function ensureFriendCode(ctx: MutationCtx, user: Doc<"users">) {
  if (user.friendCode) return user.friendCode;
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
    if (await ctx.db.query("users").withIndex("by_friend_code", (q) => q.eq("friendCode", code)).first()) continue;
    await ctx.db.patch(user._id, { friendCode: code });
    return code;
  }
  throw new Error("Could not generate a unique friend code");
}
