import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export const callerFor = (ctx: QueryCtx, deviceId: string) =>
  ctx.db.query("users").withIndex("by_device", (q) => q.eq("deviceId", deviceId)).unique();

export async function requireCaller(ctx: QueryCtx, deviceId: string) {
  const user = await callerFor(ctx, deviceId);
  if (!user) throw new ConvexError({ code: "not_onboarded", message: "Finish onboarding first" });
  return user;
}

export const isVerifiedHost = (user: Doc<"users">) =>
  user.role === "host" && user.workEmailVerifiedAt !== undefined && user.workDomain !== undefined && user.workEmail !== undefined;

export function requireHost(user: Doc<"users">) {
  if (!isVerifiedHost(user)) throw new ConvexError({ code: "host_required", message: "Verify a work email as a host to use company features" });
  return user as Doc<"users"> & { workEmail: string; workDomain: string; workEmailVerifiedAt: number };
}

export async function requireHostCaller(ctx: QueryCtx, deviceId: string) {
  return requireHost(await requireCaller(ctx, deviceId));
}
