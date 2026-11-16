import { convexTest } from "convex-test";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { ConvexError } from "convex/values";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;

beforeAll(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  vi.stubEnv("JWT_PRIVATE_KEY", (await exportPKCS8(keys.privateKey)).trimEnd().replace(/\n/g, " "));
  vi.stubEnv("JWKS", JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(keys.publicKey)) }] }));
  vi.stubEnv("CONVEX_SITE_URL", "https://scout.test");
  vi.stubEnv("SITE_URL", "http://localhost:8081");
});

afterEach(() => {
  vi.useRealTimers();
});

const profile = (deviceId: string, email: string) => ({
  deviceId, role: "student" as const, interests: ["ai"], city: "San Francisco", lat: 37.77, lng: -122.42,
  locationSource: "city" as const, name: "Ada Lovelace", email,
});

type T = ReturnType<typeof convexTest>;
const signUp = (t: T, deviceId: string, email: string, password = PASSWORD) =>
  t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email, password, deviceId } });
const signIn = (t: T, email: string, password = PASSWORD) =>
  t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", email, password } });

async function onboarded(t: T, deviceId: string, email: string) {
  const userId = await t.mutation(api.users.upsert, profile(deviceId, email));
  const eventId = await t.run((ctx) => ctx.db.insert("events", {
    source: "test", sourceId: deviceId, title: "Pitch night", description: "", startTime: Date.now() + HOUR,
    timezone: "America/Los_Angeles", city: "San Francisco", isOnline: false, url: "https://example.com",
    hosts: [], tags: [], eventType: "networking", audience: ["students"], investorScore: 0, investorSignals: [], lastSeenAt: Date.now(),
  }));
  await t.mutation(api.saves.toggle, { deviceId, eventId });
  await t.mutation(api.attendance.setGoing, { deviceId, eventId, going: true });
  return { userId, eventId };
}

const sessionFor = async (t: T, userId: Id<"users">) => {
  const session = (await t.run((ctx) => ctx.db.query("authSessions").collect())).find((s) => s.userId === userId);
  return t.withIdentity({ subject: `${userId}|${session!._id}` });
};

describe("password accounts", () => {
  test("sign up links the device's existing profile row and stores only a hash", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await onboarded(t, "dev-a", "ada@stanford.edu");
    const result = await signUp(t, "dev-a", " Ada@Stanford.EDU ");
    expect(result.tokens?.token).toBeTruthy();
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ _id: userId, deviceId: "dev-a", name: "Ada Lovelace", email: "ada@stanford.edu" });
    const accounts = await t.run((ctx) => ctx.db.query("authAccounts").collect());
    expect(accounts).toEqual([expect.objectContaining({ userId, provider: "password", providerAccountId: "ada@stanford.edu" })]);
    const everything = JSON.stringify(await t.run(async (ctx) => Promise.all(
      (["users", "authAccounts", "authSessions", "authRefreshTokens", "authRateLimits"] as const).map((table) => ctx.db.query(table).collect()),
    )));
    expect(everything).not.toContain(PASSWORD);
  });

  test("sign up requires onboarding, a free email, a device without an account, and an 8 to 128 character password", async () => {
    const t = convexTest(schema, modules);
    await onboarded(t, "dev-a", "ada@stanford.edu");
    await onboarded(t, "dev-b", "bob@stanford.edu");
    await expect(signUp(t, "dev-unknown", "new@stanford.edu")).rejects.toThrow();
    await expect(signUp(t, "dev-a", "ada@stanford.edu", "short")).rejects.toThrow();
    await expect(signUp(t, "dev-a", "ada@stanford.edu", "x".repeat(129))).rejects.toThrow();
    await signUp(t, "dev-a", "ada@stanford.edu");
    for (const password of [PASSWORD, "another password"]) {
      const taken = await signUp(t, "dev-b", "ADA@stanford.edu", password).catch((e: unknown) => e);
      expect((taken as ConvexError<string>).data).toBe("SIGN_UP_FAILED");
    }
    expect(await t.run((ctx) => ctx.db.query("authSessions").collect())).toHaveLength(1);
    await expect(signUp(t, "dev-a", "other@stanford.edu")).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("authAccounts").collect())).toHaveLength(1);
  });

  test("sign in by email restores the account's deviceId only through an authenticated session", async () => {
    const t = convexTest(schema, modules);
    const { userId, eventId } = await onboarded(t, "dev-a", "ada@stanford.edu");
    await signUp(t, "dev-a", "ada@stanford.edu");
    await t.run(async (ctx) => {
      for (const s of await ctx.db.query("authSessions").collect()) await ctx.db.delete(s._id);
    });
    expect(await t.query(api.users.accountDeviceId, {})).toBeNull();
    const result = await signIn(t, "ADA@stanford.edu ");
    expect(result.tokens?.token).toBeTruthy();
    const deviceId = await (await sessionFor(t, userId)).query(api.users.accountDeviceId, {});
    expect(deviceId).toBe("dev-a");
    expect((await t.query(api.saves.list, { deviceId: deviceId! })).map((e) => e._id)).toEqual([eventId]);
    expect(await t.query(api.attendance.mine, { deviceId: deviceId! })).toEqual([{ eventId, going: true }]);
  });

  test("the deviceId bridge needs a live session and only returns the caller's own deviceId", async () => {
    const t = convexTest(schema, modules);
    const a = await onboarded(t, "dev-a", "ada@stanford.edu");
    const b = await onboarded(t, "dev-b", "bob@stanford.edu");
    await signUp(t, "dev-a", "ada@stanford.edu");
    await signUp(t, "dev-b", "bob@stanford.edu");
    expect(await t.query(api.users.accountDeviceId, {})).toBeNull();
    expect(await (await sessionFor(t, a.userId)).query(api.users.accountDeviceId, {})).toBe("dev-a");
    expect(await (await sessionFor(t, b.userId)).query(api.users.accountDeviceId, {})).toBe("dev-b");
    const otherSession = (await t.run((ctx) => ctx.db.query("authSessions").collect())).find((s) => s.userId === b.userId);
    expect(await t.withIdentity({ subject: `${a.userId}|${otherSession!._id}` }).query(api.users.accountDeviceId, {})).toBeNull();
    const signedIn = await sessionFor(t, a.userId);
    await signedIn.action(api.auth.signOut, {});
    expect(await signedIn.query(api.users.accountDeviceId, {})).toBeNull();
  });

  test("a wrong password and an unknown email both fail", async () => {
    const t = convexTest(schema, modules);
    await onboarded(t, "dev-a", "ada@stanford.edu");
    await signUp(t, "dev-a", "ada@stanford.edu");
    for (const attempt of [() => signIn(t, "ada@stanford.edu", "wrong password"), () => signIn(t, "nobody@stanford.edu"), () => signIn(t, "not an email")]) {
      const error = await attempt().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConvexError);
      expect((error as ConvexError<string>).data).toBe("INVALID_CREDENTIALS");
    }
  });

  test("sign-up failures look the same whether or not the email has an account", async () => {
    const t = convexTest(schema, modules);
    await onboarded(t, "dev-a", "ada@stanford.edu");
    await onboarded(t, "dev-b", "bob@stanford.edu");
    await signUp(t, "dev-a", "ada@stanford.edu");
    for (const [deviceId, email] of [["dev-bogus", "ada@stanford.edu"], ["dev-bogus", "new@stanford.edu"], ["dev-a", "new@stanford.edu"], ["dev-b", "ada@stanford.edu"]]) {
      const error = await signUp(t, deviceId, email).catch((e: unknown) => e);
      expect((error as ConvexError<string>).data, `${deviceId} ${email}`).toBe("SIGN_UP_FAILED");
    }
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(2);
  });

  test("only the password sign-up and sign-in flows are reachable", async () => {
    const t = convexTest(schema, modules);
    await onboarded(t, "dev-a", "ada@stanford.edu");
    await signUp(t, "dev-a", "ada@stanford.edu");
    for (const flow of ["reset", "reset-verification", "email-verification", undefined]) {
      const error = await t.action(api.auth.signIn, { provider: "password", params: { flow, email: "ada@stanford.edu", password: PASSWORD, newPassword: "new password 123", code: "123" } }).catch((e: unknown) => e);
      expect((error as ConvexError<string>).data, String(flow)).toBe("UNSUPPORTED_FLOW");
    }
    for (const args of [{ provider: "anonymous", params: {} }, { params: { code: "123" } }, { refreshToken: "forged|token" }]) {
      const result = await t.action(api.auth.signIn, args).catch(() => null);
      expect(result?.tokens ?? null, JSON.stringify(args)).toBeNull();
    }
    expect(await t.run((ctx) => ctx.db.query("authSessions").collect())).toHaveLength(1);
    const long = await signIn(t, "ada@stanford.edu", "x".repeat(129)).catch((e: unknown) => e);
    expect((long as ConvexError<string>).data).toBe("INVALID_CREDENTIALS");
  });

  test("ten failed sign-ins lock the account for the hour, even with the right password", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = convexTest(schema, modules);
    await onboarded(t, "dev-a", "ada@stanford.edu");
    await signUp(t, "dev-a", "ada@stanford.edu");
    for (let i = 0; i < 10; i++) await expect(signIn(t, "ada@stanford.edu", `wrong-${i}-password`)).rejects.toThrow();
    const locked = await signIn(t, "ada@stanford.edu").catch((e: unknown) => e);
    expect((locked as ConvexError<string>).data).toBe("INVALID_CREDENTIALS");
    expect((await t.run((ctx) => ctx.db.query("authRateLimits").collect()))[0]).toMatchObject({ attemptsLeft: 0 });
    vi.setSystemTime(Date.now() + HOUR);
    expect((await signIn(t, "ada@stanford.edu")).tokens?.token).toBeTruthy();
    expect(await t.run((ctx) => ctx.db.query("authRateLimits").collect())).toEqual([]);
  });

  test("an account's email can't be changed through the profile, other fields still can", async () => {
    const t = convexTest(schema, modules);
    await onboarded(t, "dev-a", "ada@stanford.edu");
    await signUp(t, "dev-a", "ada@stanford.edu");
    await expect(t.mutation(api.users.upsert, profile("dev-a", "ada@other.edu"))).rejects.toThrow();
    await t.mutation(api.users.upsert, { ...profile("dev-a", "ADA@stanford.edu"), name: "Ada King" });
    expect(await t.query(api.users.get, { deviceId: "dev-a" })).toMatchObject({ name: "Ada King", email: "ada@stanford.edu" });
  });
});

describe("http routes", () => {
  test("the auth routes and the Scout test fixture route are both served", async () => {
    vi.stubEnv("ENABLE_TEST_FIXTURES", "1");
    const t = convexTest(schema, modules);
    const openid = await t.fetch("/.well-known/openid-configuration");
    expect(openid.status).toBe(200);
    expect((await openid.json()).issuer).toBe("https://scout.test");
    expect((await t.fetch("/.well-known/jwks.json")).status).toBe(200);
    const fixture = await t.fetch("/fixtures/scout-test-event");
    expect(fixture.status).toBe(200);
    expect(fixture.headers.get("content-type")).toContain("text/html");
  });
});
