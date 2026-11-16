import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError, v, type Value } from "convex/values";
import { Scrypt } from "lucia";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { MAX_FAILED_SIGN_INS_PER_HOUR, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, type AccountErrorCode } from "./lib/account";
import { checkContactField } from "./lib/contact";

const fail = (code: AccountErrorCode) => new ConvexError(code);

const normalizedEmail = (params: Record<string, unknown>) => {
  const email = checkContactField("email", typeof params.email === "string" ? params.email : "");
  return "value" in email ? email.value : null;
};

const passwordConfig = {
  profile(params: Record<string, unknown>) {
    const email = normalizedEmail(params);
    if (!email) throw fail("INVALID_CREDENTIALS");
    return { email, deviceId: typeof params.deviceId === "string" ? params.deviceId : "" };
  },
  validatePasswordRequirements(password: string) {
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) throw fail("INVALID_PASSWORD");
  },
};

type Authorize = (params: Record<string, Value | undefined>, ctx: ActionCtx) => Promise<{ userId: Id<"users"> } | null>;
const libraryPassword = Password(passwordConfig) as ReturnType<typeof Password> & { options: { authorize: Authorize } };
const libraryAuthorize = libraryPassword.options.authorize;

let decoyHash: Promise<string> | null = null;
const burnPasswordCheck = async (password: string) => {
  decoyHash ??= new Scrypt().hash(crypto.randomUUID());
  await new Scrypt().verify(await decoyHash, password);
};

const accountFor = (ctx: QueryCtx, email: string) =>
  ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", email))
    .unique();

const unlinkedDeviceRow = async (ctx: QueryCtx, deviceId: string) => {
  const user = deviceId
    ? await ctx.db
        .query("users")
        .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
        .unique()
    : null;
  if (!user) return null;
  const linked = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", user._id))
    .first();
  return linked ? null : user;
};

export const emailHasAccount = internalQuery({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { email }) => (await accountFor(ctx, email)) !== null,
});

export const canSignUp = internalQuery({
  args: { email: v.string(), deviceId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { email, deviceId }) => (await unlinkedDeviceRow(ctx, deviceId)) !== null && (await accountFor(ctx, email)) === null,
});

const authorize: Authorize = async (params, ctx) => {
  const password = typeof params.password === "string" ? params.password : "";
  if (params.flow === "signUp") {
    const email = normalizedEmail(params);
    const deviceId = typeof params.deviceId === "string" ? params.deviceId : "";
    if (!email || !(await ctx.runQuery(internal.auth.canSignUp, { email, deviceId }))) throw fail("SIGN_UP_FAILED");
    return libraryAuthorize(params, ctx);
  }
  if (params.flow !== "signIn") throw fail("UNSUPPORTED_FLOW");
  if (!password || password.length > MAX_PASSWORD_LENGTH) throw fail("INVALID_CREDENTIALS");
  const email = normalizedEmail(params);
  if (!email || !(await ctx.runQuery(internal.auth.emailHasAccount, { email }))) {
    await burnPasswordCheck(password);
    throw fail("INVALID_CREDENTIALS");
  }
  try {
    return await libraryAuthorize({ ...params, email }, ctx);
  } catch {
    throw fail("INVALID_CREDENTIALS");
  }
};

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [{ ...libraryPassword, options: { ...libraryPassword.options, authorize } }],
  signIn: { maxFailedAttempsPerHour: MAX_FAILED_SIGN_INS_PER_HOUR },
  callbacks: {
    async createOrUpdateUser(genericCtx, { existingUserId, profile }) {
      if (existingUserId) return existingUserId;
      const ctx = genericCtx as unknown as MutationCtx;
      const user = await unlinkedDeviceRow(ctx, typeof profile.deviceId === "string" ? profile.deviceId : "");
      if (!user) throw fail("SIGN_UP_FAILED");
      await ctx.db.patch(user._id, { email: profile.email });
      return user._id;
    },
  },
});
