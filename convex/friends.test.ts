import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const NOW = Date.UTC(2026, 10, 15, 12);
const DAY = 86_400_000;

const person = (deviceId: string, name?: string) => ({
  deviceId, role: "student" as const, interests: ["ai"], city: "San Francisco", lat: 37.77, lng: -122.42, locationSource: "city" as const,
  ...(name ? { name, email: `${deviceId}@example.com`, phone: "+14155550100", linkedin: `https://www.linkedin.com/in/${deviceId}`, affiliation: "Stanford" } : {}),
});
const codeOf = (promise: Promise<unknown>) => promise.then(() => "ok", (e: { data?: { code?: string } }) => e.data?.code ?? String(e));

async function setup() {
  const t = convexTest(schema, modules);
  const ids: Record<string, string> = {};
  for (const [device, name] of [["alice", "Alice"], ["bob", "Bob"], ["carol", "Carol"], ["dave", undefined]] as const) {
    ids[device] = await t.mutation(api.users.upsert, person(device, name));
  }
  const code = async (deviceId: string) => (await t.mutation(api.friends.myCode, { deviceId })).friendCode;
  return { t, ids, code };
}

describe("friends", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => vi.useRealTimers());

  test("myCode is lazy, stable, 6 to 8 characters, unique, and survives a profile update", async () => {
    const { t, code } = await setup();
    const alice = await code("alice");
    expect(alice).toMatch(/^[A-Z0-9]{6,8}$/);
    expect(await code("alice")).toBe(alice);
    await t.mutation(api.users.upsert, person("alice", "Alice Renamed"));
    expect(await code("alice")).toBe(alice);
    expect(await code("bob")).not.toBe(alice);
    expect(await codeOf(t.mutation(api.friends.myCode, { deviceId: "nobody" }))).toBe("not_onboarded");
  });

  test("request and accept, with list rows for both sides", async () => {
    const { t, ids, code } = await setup();
    const bobCode = await code("bob");
    const sent = await t.mutation(api.friends.request, { deviceId: "alice", friendCode: ` ${bobCode.toLowerCase()} ` });
    expect(sent.status).toBe("pending");
    if (sent.status !== "pending") throw new Error("expected pending");
    expect(await t.query(api.friends.list, { deviceId: "alice" })).toEqual({
      friends: [], incoming: [], outgoing: [{ requestId: sent.requestId, userId: ids.bob, name: "Bob", affiliation: "Stanford" }],
    });
    expect(await t.query(api.friends.list, { deviceId: "bob" })).toEqual({
      friends: [], outgoing: [], incoming: [{ requestId: sent.requestId, userId: ids.alice, name: "Alice", affiliation: "Stanford" }],
    });
    expect(await codeOf(t.mutation(api.friends.request, { deviceId: "alice", friendCode: bobCode }))).toBe("already_requested");
    expect(await codeOf(t.mutation(api.friends.respond, { deviceId: "alice", requestId: sent.requestId, accept: true }))).toBe("forbidden");
    expect(await codeOf(t.mutation(api.friends.respond, { deviceId: "carol", requestId: sent.requestId, accept: true }))).toBe("forbidden");
    await t.mutation(api.friends.respond, { deviceId: "bob", requestId: sent.requestId, accept: true });
    expect((await t.query(api.friends.list, { deviceId: "alice" })).friends).toEqual([{ userId: ids.bob, name: "Bob", affiliation: "Stanford" }]);
    expect((await t.query(api.friends.list, { deviceId: "bob" })).friends).toEqual([{ userId: ids.alice, name: "Alice", affiliation: "Stanford" }]);
    expect(await codeOf(t.mutation(api.friends.request, { deviceId: "bob", friendCode: await code("alice") }))).toBe("already_friends");
    expect(await codeOf(t.mutation(api.friends.respond, { deviceId: "bob", requestId: sent.requestId, accept: true }))).toBe("not_pending");
  });

  test("a mutual request auto-accepts and keeps one row per pair", async () => {
    const { t, ids, code } = await setup();
    await t.mutation(api.friends.request, { deviceId: "alice", friendCode: await code("bob") });
    expect(await t.mutation(api.friends.request, { deviceId: "bob", friendCode: await code("alice") })).toEqual({ status: "accepted", friendUserId: ids.alice });
    expect(await t.run((ctx) => ctx.db.query("friendships").collect())).toMatchObject([{ requesterId: ids.alice, addresseeId: ids.bob, status: "accepted", respondedAt: expect.any(Number) }]);
  });

  test("invalid and own codes are rejected", async () => {
    const { t, code } = await setup();
    await code("bob");
    for (const friendCode of ["", "ABC", "NOPE-NOPE-NOPE", "ZZZZZZZZ"]) expect(await codeOf(t.mutation(api.friends.request, { deviceId: "alice", friendCode }))).toBe("invalid_code");
    expect(await codeOf(t.mutation(api.friends.request, { deviceId: "alice", friendCode: await code("alice") }))).toBe("self");
    expect(await codeOf(t.mutation(api.friends.request, { deviceId: "nobody", friendCode: await code("bob") }))).toBe("not_onboarded");
  });

  test("decline deletes the request, and cancel is sender-only", async () => {
    const { t, code } = await setup();
    const sent = await t.mutation(api.friends.request, { deviceId: "alice", friendCode: await code("bob") });
    if (sent.status !== "pending") throw new Error("expected pending");
    await t.mutation(api.friends.respond, { deviceId: "bob", requestId: sent.requestId, accept: false });
    expect(await t.run((ctx) => ctx.db.query("friendships").collect())).toEqual([]);
    const again = await t.mutation(api.friends.request, { deviceId: "alice", friendCode: await code("bob") });
    if (again.status !== "pending") throw new Error("expected pending");
    expect(await codeOf(t.mutation(api.friends.cancel, { deviceId: "bob", requestId: again.requestId }))).toBe("forbidden");
    await t.mutation(api.friends.cancel, { deviceId: "alice", requestId: again.requestId });
    expect(await t.query(api.friends.list, { deviceId: "bob" })).toEqual({ friends: [], incoming: [], outgoing: [] });
    expect(await codeOf(t.mutation(api.friends.cancel, { deviceId: "alice", requestId: again.requestId }))).toBe("not_found");
  });

  test("remove ends a friendship from either side", async () => {
    const { t, ids, code } = await setup();
    await t.mutation(api.friends.request, { deviceId: "alice", friendCode: await code("bob") });
    await t.mutation(api.friends.request, { deviceId: "bob", friendCode: await code("alice") });
    await t.mutation(api.friends.remove, { deviceId: "bob", friendUserId: ids.alice as never });
    expect((await t.query(api.friends.list, { deviceId: "alice" })).friends).toEqual([]);
    await t.mutation(api.friends.remove, { deviceId: "bob", friendUserId: ids.alice as never });
  });

  test("no result exposes email, phone, LinkedIn, device ids, or friend codes, and unnamed users come back as null", async () => {
    const { t, ids, code } = await setup();
    const eventId = await t.run((ctx) => ctx.db.insert("events", {
      source: "test", sourceId: "e", title: "e", description: "d", startTime: NOW + DAY, timezone: "America/Los_Angeles", city: "San Francisco",
      isOnline: false, url: "https://example.com", hosts: [], tags: [], eventType: "networking", audience: ["students"], investorScore: 0, investorSignals: [], lastSeenAt: NOW,
    }));
    await t.mutation(api.friends.request, { deviceId: "bob", friendCode: await code("alice") });
    await t.mutation(api.friends.request, { deviceId: "carol", friendCode: await code("alice") });
    await t.mutation(api.friends.request, { deviceId: "alice", friendCode: await code("carol") });
    await t.mutation(api.friends.request, { deviceId: "alice", friendCode: await code("dave") });
    await t.mutation(api.attendance.setGoing, { deviceId: "carol", eventId, going: true });
    const results = [
      await t.query(api.friends.list, { deviceId: "alice" }), await t.query(api.friends.list, { deviceId: "bob" }),
      await t.query(api.friends.list, { deviceId: "dave" }), await t.query(api.friends.goingTo, { deviceId: "alice", eventId }),
    ];
    const json = JSON.stringify(results);
    for (const leak of ["@example.com", "4155550100", "linkedin", "email", "phone", "deviceId", "friendCode", "alice\"", "bob\""]) expect(json).not.toContain(leak);
    expect(results[0]).toMatchObject({ outgoing: [{ userId: ids.dave, name: null, affiliation: null }] });
    expect(results[2]).toMatchObject({ incoming: [{ userId: ids.alice, name: "Alice" }] });
  });

  test("goingTo lists accepted friends going to or attending the event, not pending requests or strangers", async () => {
    const { t, ids, code } = await setup();
    const event = (sourceId: string, startTime: number) => t.run((ctx) => ctx.db.insert("events", {
      source: "test", sourceId, title: sourceId, description: "d", startTime, endTime: startTime + 3_600_000, timezone: "America/Los_Angeles", city: "San Francisco",
      isOnline: false, url: "https://example.com", hosts: [], tags: [], eventType: "networking", audience: ["students"], investorScore: 0, investorSignals: [], lastSeenAt: NOW,
    }));
    const upcoming = await event("upcoming", NOW + DAY);
    const past = await event("past", NOW - 2 * DAY);
    await t.mutation(api.friends.request, { deviceId: "bob", friendCode: await code("alice") });
    await t.mutation(api.friends.request, { deviceId: "alice", friendCode: await code("bob") });
    await t.mutation(api.friends.request, { deviceId: "carol", friendCode: await code("alice") });
    for (const deviceId of ["bob", "carol", "dave"]) await t.mutation(api.attendance.setGoing, { deviceId, eventId: upcoming, going: true });
    expect(await t.query(api.friends.goingTo, { deviceId: "alice", eventId: upcoming })).toEqual([{ userId: ids.bob, name: "Bob" }]);
    expect(await t.query(api.friends.goingTo, { deviceId: "nobody", eventId: upcoming })).toEqual([]);
    await t.run(async (ctx) => { await ctx.db.insert("attendance", { userId: ids.bob as never, eventId: past, going: false, attended: true, rating: 9, ratingScale: 10 }); });
    expect(await t.query(api.friends.goingTo, { deviceId: "alice", eventId: past })).toEqual([{ userId: ids.bob, name: "Bob" }]);
    await t.mutation(api.attendance.setGoing, { deviceId: "bob", eventId: upcoming, going: false });
    expect(await t.query(api.friends.goingTo, { deviceId: "alice", eventId: upcoming })).toEqual([]);
  });

  test("rate limit allows 30 sent requests per rolling day", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.users.upsert, person("sender", "Sender"));
    const codes = [];
    for (let i = 0; i < 31; i++) {
      await t.mutation(api.users.upsert, person(`target-${i}`, `Target ${i}`));
      codes.push((await t.mutation(api.friends.myCode, { deviceId: `target-${i}` })).friendCode);
    }
    for (const friendCode of codes.slice(0, 30)) expect((await t.mutation(api.friends.request, { deviceId: "sender", friendCode })).status).toBe("pending");
    expect(await codeOf(t.mutation(api.friends.request, { deviceId: "sender", friendCode: codes[30] }))).toBe("rate_limited");
    vi.setSystemTime(NOW + DAY + 1);
    expect((await t.mutation(api.friends.request, { deviceId: "sender", friendCode: codes[30] })).status).toBe("pending");
  });
});
