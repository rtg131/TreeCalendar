import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { deleteEventRefs, reassignEventRefs } from "./normalize/reassignEventRefs";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const NOW = Date.UTC(2026, 10, 15, 12);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const PRIVATE = ["tal.private@stanford.edu", "14155550100", "tal-private", "Secret Labs", "tal-device"];
const event = (sourceId: string, startTime: number, hosts: string[], organizer?: string) => ({
  source: "fixture", sourceId, title: `Event ${sourceId}`, description: "Offline fixture", startTime, endTime: startTime + 2 * HOUR,
  timezone: "America/Los_Angeles", city: "San Francisco", isOnline: false, url: `https://example.com/${sourceId}`, hosts, tags: [],
  eventType: "hackathon" as const, audience: ["students" as const], investorScore: 0, investorSignals: [], lastSeenAt: 0,
  ...(organizer ? { organizer } : {}),
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

async function setup() {
  vi.setSystemTime(NOW - 10 * DAY);
  const t = convexTest(schema, modules);
  const profile = (deviceId: string, name: string, extra: Record<string, string> = {}, role: "student" | "investor" = "student") =>
    t.mutation(api.users.upsert, { deviceId, role, interests: [], city: "San Francisco", lat: 37.77, lng: -122.42, locationSource: "city", name, email: `${deviceId}@example.com`, ...extra });
  const tal = await profile("tal-device", "Tal Talent", { email: "tal.private@stanford.edu", phone: "+1 415 555 0100", linkedin: "linkedin.com/in/tal-private", affiliation: "Secret Labs" });
  const tal2 = await profile("tal2-device", "Second Talent");
  const lazy = await profile("lazy-device", "No Show");
  const own = await profile("own-device", "Olive Owner", {}, "investor");
  const mem = await profile("mem-device", "Mo Member", {}, "investor");
  const out = await profile("out-device", "Oscar Outsider", {}, "investor");
  await t.run(async (ctx) => {
    for (const [id, deviceId] of [[own, "own-device"], [mem, "mem-device"], [out, "out-device"]] as const) {
      await ctx.db.patch(id, { role: "host", workEmail: `${deviceId}@example.edu`, workDomain: "example.edu", workEmailVerifiedAt: NOW - 10 * DAY, workEmailVerifiedVia: "email" });
    }
  });
  const [past, future, other] = await t.run(async (ctx) => [
    await ctx.db.insert("events", event("past", NOW - 2 * DAY, ["ACME Labs", "Friends"])),
    await ctx.db.insert("events", event("future", NOW + 2 * DAY, [], "Acme Labs")),
    await ctx.db.insert("events", event("other", NOW - 3 * DAY, ["Other Org"])),
  ]);
  const attend = (userId: Id<"users">, eventId: Id<"events">, fields: { going?: boolean; attended?: boolean } = {}) =>
    t.run((ctx) => ctx.db.insert("attendance", { userId, eventId, going: true, ...fields }));
  for (const e of [past, future, other]) await attend(tal, e);
  await attend(tal2, past, { going: false, attended: true });
  await attend(lazy, past, { attended: false });
  const acme = await t.mutation(api.companies.create, { deviceId: "own-device", name: "Acme Labs", website: "acme.dev" });
  await t.mutation(internal.companies.verify, { slug: "Acme Labs", by: "test-admin" });
  await t.mutation(api.companies.invite, { deviceId: "own-device", companyId: acme, email: "mem-device@example.edu" });
  await t.mutation(api.companies.respondInvite, { deviceId: "mem-device", companyId: acme, accept: true });
  await t.mutation(api.companies.claimEvent, { deviceId: "mem-device", companyId: acme, eventId: past });
  await t.mutation(api.companies.claimEvent, { deviceId: "own-device", companyId: acme, eventId: future });
  const other2 = await t.mutation(api.companies.create, { deviceId: "out-device", name: "Other Org" });
  await t.mutation(internal.companies.verify, { companyId: other2, by: "test-admin" });
  await t.mutation(api.companies.claimEvent, { deviceId: "out-device", companyId: other2, eventId: other });
  vi.setSystemTime(NOW);
  return { t, tal, tal2, lazy, own, mem, out, past, future, other, acme, other2 };
}

const code = (promise: Promise<unknown>) => promise.then(() => "ok", (e: { data?: { code?: string } }) => e.data?.code ?? String(e));

describe("companies", () => {
  test("owner invites a member who accepts; invites never reveal accounts; outsiders see names only", async () => {
    const { t, acme, mem } = await setup();
    expect(await t.query(api.companies.mine, { deviceId: "mem-device" })).toMatchObject({ memberships: [{ role: "member", company: { name: "Acme Labs", slug: "acme-labs" } }], invites: [] });
    expect(await code(t.mutation(api.companies.invite, { deviceId: "mem-device", companyId: acme, email: "out-device@example.edu" }))).toBe("forbidden");
    await t.mutation(api.companies.invite, { deviceId: "own-device", companyId: acme, email: "OUT-DEVICE@example.edu " });
    expect(await code(t.mutation(api.companies.invite, { deviceId: "own-device", companyId: acme, email: "nobody-here@example.com" }))).toBe("ok");
    expect(await t.query(api.companies.mine, { deviceId: "out-device" })).toMatchObject({ invites: [{ company: { name: "Acme Labs" }, invitedByName: "Olive Owner" }] });
    const asOutsider = await t.query(api.companies.get, { deviceId: "tal-device", companyId: acme });
    expect(asOutsider).toMatchObject({ myRole: null, members: [{ name: "Olive Owner" }, { name: "Mo Member" }] });
    expect(asOutsider).not.toHaveProperty("pendingInvites");
    expect(JSON.stringify(asOutsider)).not.toMatch(/example\.com|device|userId|role"/);
    const asOwner = await t.query(api.companies.get, { deviceId: "own-device", companyId: acme });
    expect(asOwner!.pendingInvites!.map((i) => i.email)).toEqual(["nobody-here@example.com", "out-device@example.edu"]);
    expect(JSON.stringify(asOwner)).not.toContain("Oscar Outsider");
    await t.mutation(api.companies.cancelInvite, { deviceId: "own-device", companyId: acme, email: "nobody-here@example.com" });
    await t.mutation(api.companies.respondInvite, { deviceId: "out-device", companyId: acme, accept: false });
    expect(await t.query(api.companies.mine, { deviceId: "out-device" })).toMatchObject({ invites: [] });
    expect((await t.query(api.companies.get, { deviceId: "own-device", companyId: acme }))!.pendingInvites).toEqual([]);
    expect(await code(t.mutation(api.companies.respondInvite, { deviceId: "out-device", companyId: acme, accept: true }))).toBe("not_found");
    expect(await code(t.mutation(api.companies.create, { deviceId: "out-device", name: "acme  labs!" }))).toBe("invalid");

    expect(await code(t.mutation(api.companies.removeMember, { deviceId: "mem-device", companyId: acme, userId: (await t.query(api.companies.get, { deviceId: "mem-device", companyId: acme }))!.members[0].userId! }))).toBe("forbidden");
    await t.mutation(api.companies.removeMember, { deviceId: "own-device", companyId: acme, userId: mem });
    expect(await t.query(api.companies.mine, { deviceId: "mem-device" })).toMatchObject({ memberships: [] });
    expect(await code(t.query(api.connections.eventTalent, { deviceId: "mem-device", companyId: acme, eventId: (await t.query(api.companies.get, { deviceId: "x", companyId: acme }))!.hostedEvents[1]._id }))).toBe("forbidden");
  });

  test("events link only through a member's claim when hosts or organizer match", async () => {
    const { t, acme, other, past } = await setup();
    expect(await code(t.mutation(api.companies.claimEvent, { deviceId: "own-device", companyId: acme, eventId: other }))).toBe("forbidden");
    expect(await code(t.mutation(api.companies.claimEvent, { deviceId: "tal-device", companyId: acme, eventId: past }))).toBe("host_required");
    expect(await code(t.mutation(api.companies.unclaimEvent, { deviceId: "mem-device", companyId: acme, eventId: past }))).toBe("forbidden");
    expect((await t.query(api.companies.get, { deviceId: "x", companyId: acme }))!.hostedEvents.map((e) => e.title)).toEqual(["Event future", "Event past"]);
    await t.mutation(api.companies.unclaimEvent, { deviceId: "own-device", companyId: acme, eventId: past });
    expect(await code(t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: acme, eventId: past }))).toBe("not_eligible");
  });
});

describe("eligibility", () => {
  test("rejects before the event ends, without attendance, for a non-host company and for non-talent", async () => {
    const { t, acme, past, future, other, other2, lazy } = await setup();
    expect(await code(t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: acme, eventId: future }))).toBe("not_eligible");
    expect(await code(t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: acme, eventId: other }))).toBe("not_eligible");
    expect(await code(t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: other2, eventId: past }))).toBe("not_eligible");
    expect(await code(t.mutation(api.connections.expressInterest, { deviceId: "lazy-device", companyId: acme, eventId: past }))).toBe("not_eligible");
    expect(await code(t.mutation(api.connections.expressInterest, { deviceId: "out-device", companyId: acme, eventId: past }))).toBe("not_eligible");
    expect(await code(t.mutation(api.connections.expressInterest, { deviceId: "nobody", companyId: acme, eventId: past }))).toBe("not_onboarded");
    expect(await code(t.mutation(api.connections.expressInterestInTalent, { deviceId: "mem-device", companyId: acme, talentUserId: lazy, eventId: past }))).toBe("not_eligible");
    expect(await code(t.mutation(api.connections.expressInterestInTalent, { deviceId: "out-device", companyId: acme, talentUserId: lazy, eventId: past }))).toBe("forbidden");
    vi.setSystemTime(NOW + 3 * DAY);
    expect(await t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: acme, eventId: future })).toMatchObject({ status: "pending" });
    expect(await t.mutation(api.connections.expressInterest, { deviceId: "tal2-device", companyId: acme, eventId: past })).toMatchObject({ status: "pending" });
  });

  test("a going record created after the event ended does not make talent eligible", async () => {
    const { t, acme, past, out } = await setup();
    await t.mutation(api.users.upsert, { deviceId: "late-device", role: "student", interests: [], city: "SF", lat: 0, lng: 0, locationSource: "city", name: "Late" });
    await t.run(async (ctx) => {
      const late = (await ctx.db.query("users").withIndex("by_device", (q) => q.eq("deviceId", "late-device")).unique())!;
      await ctx.db.insert("attendance", { userId: late._id, eventId: past, going: true });
    });
    expect(await code(t.mutation(api.connections.expressInterest, { deviceId: "late-device", companyId: acme, eventId: past }))).toBe("not_eligible");
    expect((await t.query(api.connections.eventTalent, { deviceId: "own-device", companyId: acme, eventId: past })).map((r) => r.talent.name)).not.toContain("Late");
    expect(out).toBeDefined();
  });

  test("discover and eventTalent list only eligible pairs without contact fields", async () => {
    const { t, acme, past, future, tal, tal2 } = await setup();
    const found = await t.query(api.connections.discover, { deviceId: "tal-device" });
    expect(found.map((f) => [f.event.title, f.companies.map((c) => c.company.name)])).toEqual([["Event past", ["Acme Labs"]], ["Event other", ["Other Org"]]]);
    const talent = await t.query(api.connections.eventTalent, { deviceId: "mem-device", companyId: acme, eventId: past });
    expect(talent.map((r) => r.talent)).toEqual([{ userId: tal, name: "Tal Talent", role: "student" }, { userId: tal2, name: "Second Talent", role: "student" }]);
    expect(await t.query(api.connections.eventTalent, { deviceId: "mem-device", companyId: acme, eventId: future })).toEqual([]);
    expect(await code(t.query(api.connections.eventTalent, { deviceId: "tal-device", companyId: acme, eventId: past }))).toBe("host_required");
    for (const secret of PRIVATE) expect(JSON.stringify(talent)).not.toContain(secret);
  });
});

describe("interest and invitations", () => {
  test("mutual interest auto-accepts in both directions, keeping one live connection per pair", async () => {
    const { t, acme, past, tal, tal2 } = await setup();
    const first = await t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: acme, eventId: past, message: "Loved the demo" });
    expect(first.status).toBe("pending");
    expect(await t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: acme, eventId: past })).toEqual(first);
    expect(await t.mutation(api.connections.expressInterestInTalent, { deviceId: "mem-device", companyId: acme, talentUserId: tal, eventId: past, message: "Let's talk" }))
      .toEqual({ connectionId: first.connectionId, status: "accepted" });
    expect((await t.query(api.chat.list, { deviceId: "tal-device", connectionId: first.connectionId })).messages).toMatchObject([{ body: "Let's talk", fromTalent: false, senderName: "Mo Member", mine: false }]);

    const second = await t.mutation(api.connections.expressInterestInTalent, { deviceId: "own-device", companyId: acme, talentUserId: tal2, eventId: past });
    expect(second.status).toBe("pending");
    expect(await t.mutation(api.connections.expressInterest, { deviceId: "tal2-device", companyId: acme, eventId: past })).toEqual({ connectionId: second.connectionId, status: "accepted" });
    expect(await t.run((ctx) => ctx.db.query("connections").collect())).toHaveLength(2);
  });

  test("accept, decline, withdraw and the 30-day block", async () => {
    const { t, acme, past, tal, tal2 } = await setup();
    const a = await t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: acme, eventId: past });
    expect(await code(t.mutation(api.connections.respond, { deviceId: "tal-device", connectionId: a.connectionId, accept: true }))).toBe("forbidden");
    expect(await code(t.mutation(api.connections.respond, { deviceId: "out-device", connectionId: a.connectionId, accept: true }))).toBe("not_found");
    expect(await t.mutation(api.connections.respond, { deviceId: "own-device", connectionId: a.connectionId, accept: false })).toEqual({ status: "declined" });
    expect(await code(t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: acme, eventId: past }))).toBe("blocked");
    expect((await t.query(api.connections.discover, { deviceId: "tal-device" }))[0].companies[0]).toMatchObject({ connectionStatus: "declined", blockedUntil: expect.closeTo(NOW + 30 * DAY, -3) });
    const back = await t.mutation(api.connections.expressInterestInTalent, { deviceId: "mem-device", companyId: acme, talentUserId: tal, eventId: past });
    expect(back.status).toBe("pending");
    await t.mutation(api.connections.withdraw, { deviceId: "own-device", connectionId: back.connectionId });
    vi.setSystemTime(NOW + 30 * DAY + 1);
    expect((await t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: acme, eventId: past })).status).toBe("pending");

    const b = await t.mutation(api.connections.expressInterestInTalent, { deviceId: "mem-device", companyId: acme, talentUserId: tal2, eventId: past });
    expect(await code(t.mutation(api.connections.withdraw, { deviceId: "tal2-device", connectionId: b.connectionId }))).toBe("forbidden");
    expect(await t.mutation(api.connections.respond, { deviceId: "tal2-device", connectionId: b.connectionId, accept: true })).toEqual({ status: "accepted" });
    expect(await t.mutation(api.connections.respond, { deviceId: "tal2-device", connectionId: b.connectionId, accept: false })).toEqual({ status: "declined" });
    expect(await code(t.mutation(api.connections.expressInterestInTalent, { deviceId: "own-device", companyId: acme, talentUserId: tal2, eventId: past }))).toBe("blocked");
    expect(await code(t.query(api.chat.list, { deviceId: "tal2-device", connectionId: b.connectionId }))).toBe("forbidden");
    expect(await code(t.mutation(api.connections.respond, { deviceId: "tal2-device", connectionId: b.connectionId, accept: true }))).toBe("invalid");
  });

  test("rate limits: 20 talent interests and 50 company interests per rolling day", async () => {
    const { t, acme, past, own } = await setup();
    const companies = await t.run(async (ctx) => {
      const ids = [];
      for (let i = 0; i < 21; i++) {
        const companyId = await ctx.db.insert("companies", { name: `Host ${i}`, slug: `host-${i}`, createdAt: NOW, verifiedAt: NOW, verifiedBy: "test-admin" });
        await ctx.db.insert("event_hosts", { eventId: past, companyId, claimedBy: own, createdAt: NOW });
        ids.push(companyId);
      }
      return ids;
    });
    for (const companyId of companies.slice(0, 20)) expect((await t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId, eventId: past })).status).toBe("pending");
    expect(await code(t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: companies[20], eventId: past }))).toBe("rate_limited");
    vi.setSystemTime(NOW + DAY + 1);
    expect((await t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: companies[20], eventId: past })).status).toBe("pending");

    const later = await t.run((ctx) => ctx.db.insert("events", event("later", NOW + 2 * DAY, ["Acme Labs"])));
    await t.mutation(api.companies.claimEvent, { deviceId: "own-device", companyId: acme, eventId: later });
    const talents = await t.run(async (ctx) => {
      const ids = [];
      for (let i = 0; i < 51; i++) {
        const userId = await ctx.db.insert("users", { deviceId: `bulk-${i}`, role: "student", interests: [], city: "SF", lat: 0, lng: 0, locationSource: "city", updatedAt: 0 });
        ids.push(userId);
      }
      return ids;
    });
    await t.run(async (ctx) => { for (const userId of talents) await ctx.db.insert("attendance", { userId, eventId: later, going: true }); });
    vi.setSystemTime(NOW + 5 * DAY);
    for (const talentUserId of talents.slice(0, 50)) await t.mutation(api.connections.expressInterestInTalent, { deviceId: "mem-device", companyId: acme, talentUserId, eventId: later });
    expect(await code(t.mutation(api.connections.expressInterestInTalent, { deviceId: "own-device", companyId: acme, talentUserId: talents[50], eventId: later }))).toBe("rate_limited");
  });
});

describe("chat", () => {
  test("only the talent and company members chat, and only once accepted", async () => {
    const { t, acme, past } = await setup();
    const { connectionId } = await t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: acme, eventId: past });
    for (const deviceId of ["tal-device", "own-device"]) {
      expect(await code(t.mutation(api.chat.send, { deviceId, connectionId, body: "hi" }))).toBe("forbidden");
      expect(await code(t.query(api.chat.list, { deviceId, connectionId }))).toBe("forbidden");
    }
    await t.mutation(api.connections.respond, { deviceId: "mem-device", connectionId, accept: true });
    for (const deviceId of ["out-device", "tal2-device", "nobody"]) {
      expect(await code(t.mutation(api.chat.send, { deviceId, connectionId, body: "hi" }))).not.toBe("ok");
      expect(await code(t.query(api.chat.list, { deviceId, connectionId }))).not.toBe("ok");
    }
    for (let i = 0; i < 5; i++) await t.mutation(api.chat.send, { deviceId: i % 2 ? "own-device" : "tal-device", connectionId, body: `m${i}` });
    expect(await code(t.mutation(api.chat.send, { deviceId: "tal-device", connectionId, body: "x".repeat(2001) }))).toBe("invalid");
    expect(await code(t.mutation(api.chat.send, { deviceId: "tal-device", connectionId, body: "   " }))).toBe("invalid");
    expect(await code(t.query(api.chat.list, { deviceId: "tal-device", connectionId, limit: Number.NaN }))).toBe("invalid");
    const page1 = await t.query(api.chat.list, { deviceId: "mem-device", connectionId, limit: 3 });
    expect(page1.messages.map((m) => m.body)).toEqual(["m2", "m3", "m4"]);
    expect(page1.messages[1]).toMatchObject({ senderName: "Olive Owner", fromTalent: false, mine: false });
    const page2 = await t.query(api.chat.list, { deviceId: "tal-device", connectionId, limit: 3, before: page1.nextBefore! });
    expect(page2).toMatchObject({ messages: [{ body: "m0", mine: true, fromTalent: true }, { body: "m1" }], nextBefore: null });
  });
});

describe("privacy", () => {
  test("company-visible results carry no contact fields before acceptance or without shareContact", async () => {
    const { t, acme, past, tal } = await setup();
    const scan = async () => {
      const results = [
        await t.query(api.connections.inbox, { deviceId: "own-device" }),
        await t.query(api.connections.inbox, { deviceId: "mem-device" }),
        await t.query(api.connections.eventTalent, { deviceId: "mem-device", companyId: acme, eventId: past }),
        await t.query(api.companies.get, { deviceId: "own-device", companyId: acme }),
      ];
      return JSON.stringify(results);
    };
    const { connectionId } = await t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: acme, eventId: past, message: "hello" });
    await t.mutation(api.connections.setShareContact, { deviceId: "tal-device", connectionId, shareContact: true });
    for (const secret of PRIVATE) expect(await scan()).not.toContain(secret);
    const pending = (await t.query(api.connections.inbox, { deviceId: "own-device" })).companies[0];
    expect(pending.incoming[0]).toMatchObject({ talent: { userId: tal, name: "Tal Talent", role: "student" }, contact: null, event: { title: "Event past" }, message: "hello" });

    expect(await code(t.mutation(api.connections.setShareContact, { deviceId: "own-device", connectionId, shareContact: false }))).toBe("forbidden");
    await t.mutation(api.connections.setShareContact, { deviceId: "tal-device", connectionId, shareContact: false });
    await t.mutation(api.connections.respond, { deviceId: "own-device", connectionId, accept: true });
    await t.mutation(api.chat.send, { deviceId: "own-device", connectionId, body: "welcome" });
    expect(JSON.stringify(await t.query(api.chat.list, { deviceId: "own-device", connectionId }))).not.toMatch(/private|14155550100|Secret Labs|device/);
    for (const secret of PRIVATE) expect(await scan()).not.toContain(secret);

    await t.mutation(api.connections.setShareContact, { deviceId: "tal-device", connectionId, shareContact: true });
    const shared = (await t.query(api.connections.inbox, { deviceId: "mem-device" })).companies[0].connected[0];
    expect(shared.contact).toEqual({ email: "tal.private@stanford.edu", phone: "+14155550100", linkedin: "https://www.linkedin.com/in/tal-private", affiliation: "Secret Labs" });
    expect(JSON.stringify(await t.query(api.connections.inbox, { deviceId: "tal-device" }))).not.toMatch(/example\.com|own-device|mem-device/);
  });
});

describe("professional profile", () => {
  test("users.upsert enforces word and character limits, keeps omitted values and clears on empty string", async () => {
    const { t, tal } = await setup();
    const base = { deviceId: "tal-device", role: "student" as const, interests: [], city: "SF", lat: 0, lng: 0, locationSource: "city" as const };
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    await t.mutation(api.users.upsert, { ...base, priorRoles: `  ${words(50)} `, experience: `Intern at Acme\r\n\n\n\n${words(97)}` });
    const stored = await t.run((ctx) => ctx.db.get(tal));
    expect(stored).toMatchObject({ priorRoles: words(50), experience: `Intern at Acme\n\n${words(97)}`, email: "tal.private@stanford.edu" });
    for (const [field, value] of [["priorRoles", words(51)], ["experience", words(101)], ["priorRoles", "x".repeat(401)], ["experience", "y".repeat(801)], ["priorRoles", "a\u200bb"]] as const) {
      await expect(t.mutation(api.users.upsert, { ...base, [field]: value })).rejects.toMatchObject({ data: { field } });
    }
    await t.mutation(api.users.upsert, { ...base, name: "Tal Talent" });
    expect(await t.run((ctx) => ctx.db.get(tal))).toMatchObject({ priorRoles: words(50) });
    await t.mutation(api.users.upsert, { ...base, priorRoles: "", experience: "  " });
    const cleared = await t.run((ctx) => ctx.db.get(tal));
    expect(cleared?.priorRoles).toBeUndefined();
    expect(cleared?.experience).toBeUndefined();
  });

  test("talentProfile is for members about eligible or connected talent, with contact gated", async () => {
    const { t, acme, other2, past, tal, tal2, lazy } = await setup();
    await t.run((ctx) => ctx.db.patch(tal, { priorRoles: "PM intern", experience: "Two summers at Initech" }));
    const profile = await t.query(api.connections.talentProfile, { deviceId: "mem-device", companyId: acme, talentUserId: tal });
    expect(profile).toEqual({
      talent: { userId: tal, name: "Tal Talent", role: "student", affiliation: "Secret Labs", priorRoles: "PM intern", experience: "Two summers at Initech" },
      sharedEvents: [{ _id: past, title: "Event past", startTime: NOW - 2 * DAY, endTime: NOW - 2 * DAY + 2 * HOUR }],
      connection: null, contact: null,
    });
    for (const secret of ["tal.private@stanford.edu", "14155550100", "tal-private", "tal-device"]) expect(JSON.stringify(profile)).not.toContain(secret);
    expect(await code(t.query(api.connections.talentProfile, { deviceId: "tal2-device", companyId: acme, talentUserId: tal }))).toBe("host_required");
    expect(await code(t.query(api.connections.talentProfile, { deviceId: "nobody", companyId: acme, talentUserId: tal }))).toBe("not_onboarded");
    expect(await code(t.query(api.connections.talentProfile, { deviceId: "mem-device", companyId: acme, talentUserId: lazy }))).toBe("not_found");
    expect(await code(t.query(api.connections.talentProfile, { deviceId: "out-device", companyId: other2, talentUserId: tal2 }))).toBe("not_found");

    const { connectionId } = await t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: acme, eventId: past });
    await t.mutation(api.connections.setShareContact, { deviceId: "tal-device", connectionId, shareContact: true });
    expect(await t.query(api.connections.talentProfile, { deviceId: "own-device", companyId: acme, talentUserId: tal })).toMatchObject({ connection: { _id: connectionId, status: "pending", shareContact: true }, contact: null });
    await t.mutation(api.connections.setShareContact, { deviceId: "tal-device", connectionId, shareContact: false });
    await t.mutation(api.connections.respond, { deviceId: "own-device", connectionId, accept: true });
    expect((await t.query(api.connections.talentProfile, { deviceId: "own-device", companyId: acme, talentUserId: tal })).contact).toBeNull();
    await t.mutation(api.connections.setShareContact, { deviceId: "tal-device", connectionId, shareContact: true });
    expect((await t.query(api.connections.talentProfile, { deviceId: "own-device", companyId: acme, talentUserId: tal })).contact).toEqual({
      email: "tal.private@stanford.edu", phone: "+14155550100", linkedin: "https://www.linkedin.com/in/tal-private", affiliation: "Secret Labs",
    });

    await t.run(async (ctx) => { for (const row of await ctx.db.query("event_hosts").collect()) await ctx.db.delete(row._id); });
    expect(await t.query(api.connections.talentProfile, { deviceId: "own-device", companyId: acme, talentUserId: tal })).toMatchObject({ sharedEvents: [], connection: { status: "accepted" } });
  });
});

describe("claimable events", () => {
  test("members see unclaimed, unhidden matching events newest first; others are forbidden", async () => {
    const { t, acme, past, future } = await setup();
    const [a, b, hidden, organizerOnly, unrelated, ancient] = await t.run(async (ctx) => [
      await ctx.db.insert("events", event("a", NOW - 5 * DAY, ["acme-labs"])),
      await ctx.db.insert("events", event("b", NOW + 9 * DAY, ["Friends", "Acme  Labs"])),
      await ctx.db.insert("events", { ...event("hidden", NOW - DAY, ["Acme Labs"]), hiddenAt: NOW }),
      await ctx.db.insert("events", event("org", NOW + DAY, [], "ACME LABS")),
      await ctx.db.insert("events", event("unrelated", NOW, ["Acme"])),
      await ctx.db.insert("events", event("ancient", NOW - 800 * DAY, ["Acme Labs"])),
    ]);
    const list = await t.query(api.companies.claimable, { deviceId: "mem-device", companyId: acme });
    expect(list.map((e) => e._id)).toEqual([b, organizerOnly, a]);
    expect(list[0]).toEqual({ _id: b, title: "Event b", startTime: NOW + 9 * DAY, endTime: NOW + 9 * DAY + 2 * HOUR });
    for (const id of [past, future, hidden, unrelated, ancient]) expect(list.map((e) => e._id)).not.toContain(id);
    await t.mutation(api.companies.claimEvent, { deviceId: "mem-device", companyId: acme, eventId: b });
    expect((await t.query(api.companies.claimable, { deviceId: "own-device", companyId: acme })).map((e) => e._id)).toEqual([organizerOnly, a]);
    expect(await code(t.query(api.companies.claimable, { deviceId: "tal-device", companyId: acme }))).toBe("host_required");
    expect(await code(t.query(api.companies.claimable, { deviceId: "nobody", companyId: acme }))).toBe("not_onboarded");
  });

  test("caps results at 50", async () => {
    const { t, acme } = await setup();
    await t.run(async (ctx) => { for (let i = 0; i < 60; i++) await ctx.db.insert("events", event(`bulk-${i}`, NOW - i * HOUR, ["Acme Labs"])); });
    const list = await t.query(api.companies.claimable, { deviceId: "own-device", companyId: acme });
    expect(list).toHaveLength(50);
    expect(list[0].title).toBe("Event bulk-0");
  });
});

describe("company verification", () => {
  test("new companies start unverified and every gated function throws company_unverified until approved", async () => {
    const { t, past, tal } = await setup();
    const hostEvent = await t.run((ctx) => ctx.db.insert("events", event("new-host", NOW + HOUR, ["Newco"])));
    await t.run((ctx) => ctx.db.insert("attendance", { userId: tal, eventId: hostEvent, going: true }));
    const newco = await t.mutation(api.companies.create, { deviceId: "mem-device", name: "Newco" });
    expect((await t.query(api.companies.mine, { deviceId: "mem-device" })).memberships.find((m) => m.company._id === newco)!.company.verified).toBe(false);
    await t.mutation(api.companies.invite, { deviceId: "mem-device", companyId: newco, email: "own-device@example.edu" });
    expect(await t.query(api.companies.get, { deviceId: "mem-device", companyId: newco })).toMatchObject({ company: { verified: false }, myRole: "owner" });

    const gated = () => ({
      claimEvent: code(t.mutation(api.companies.claimEvent, { deviceId: "mem-device", companyId: newco, eventId: hostEvent })),
      claimable: code(t.query(api.companies.claimable, { deviceId: "mem-device", companyId: newco })),
      eventTalent: code(t.query(api.connections.eventTalent, { deviceId: "mem-device", companyId: newco, eventId: hostEvent })),
      talentProfile: code(t.query(api.connections.talentProfile, { deviceId: "mem-device", companyId: newco, talentUserId: tal })),
      expressInterestInTalent: code(t.mutation(api.connections.expressInterestInTalent, { deviceId: "mem-device", companyId: newco, talentUserId: tal, eventId: hostEvent })),
      expressInterest: code(t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: newco, eventId: hostEvent })),
    });
    const all = async () => Object.fromEntries(await Promise.all(Object.entries(gated()).map(async ([k, p]) => [k, await p])));
    expect(await all()).toEqual({ claimEvent: "company_unverified", claimable: "company_unverified", eventTalent: "company_unverified", talentProfile: "company_unverified", expressInterestInTalent: "company_unverified", expressInterest: "company_unverified" });

    vi.setSystemTime(NOW + DAY);
    await t.run((ctx) => ctx.db.insert("event_hosts", { eventId: hostEvent, companyId: newco, claimedBy: tal, createdAt: NOW }));
    expect((await t.query(api.connections.discover, { deviceId: "tal-device" })).flatMap((d) => d.companies.map((c) => c.company.name))).not.toContain("Newco");
    await t.run(async (ctx) => { for (const h of await ctx.db.query("event_hosts").withIndex("by_company", (q) => q.eq("companyId", newco)).collect()) await ctx.db.delete(h._id); });

    expect(await t.mutation(internal.companies.verify, { slug: "newco", by: "tony" })).toMatchObject({ companyId: newco, name: "Newco", verifiedAt: expect.closeTo(NOW + DAY, -3) });
    expect(await t.run(async (ctx) => (await ctx.db.get(newco))!.verifiedBy)).toBe("tony");
    expect(await code(t.mutation(api.companies.claimEvent, { deviceId: "mem-device", companyId: newco, eventId: hostEvent }))).toBe("ok");
    expect(await t.query(api.companies.claimable, { deviceId: "mem-device", companyId: newco })).toEqual([]);
    expect(await t.query(api.connections.eventTalent, { deviceId: "mem-device", companyId: newco, eventId: hostEvent })).toHaveLength(1);
    expect((await t.query(api.connections.talentProfile, { deviceId: "mem-device", companyId: newco, talentUserId: tal })).sharedEvents).toHaveLength(1);
    expect((await t.query(api.connections.discover, { deviceId: "tal-device" })).find((d) => d.event._id === hostEvent)!.companies[0].company).toMatchObject({ name: "Newco", verified: true });
    const { connectionId } = await t.mutation(api.connections.expressInterestInTalent, { deviceId: "mem-device", companyId: newco, talentUserId: tal, eventId: hostEvent });
    expect(past).toBeDefined();

    await t.mutation(internal.companies.unverify, { companyId: newco });
    expect(await code(t.mutation(api.connections.respond, { deviceId: "tal-device", connectionId, accept: true }))).toBe("company_unverified");
    expect(await code(t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: newco, eventId: hostEvent }))).toBe("company_unverified");
    expect(await code(t.query(api.connections.eventTalent, { deviceId: "mem-device", companyId: newco, eventId: hostEvent }))).toBe("company_unverified");
    await t.mutation(internal.companies.verify, { companyId: newco, by: "tony" });
    await t.mutation(api.connections.respond, { deviceId: "tal-device", connectionId, accept: true });
    await t.mutation(api.chat.send, { deviceId: "mem-device", connectionId, body: "hello" });

    await t.mutation(internal.companies.unverify, { slug: "Newco" });
    expect((await t.query(api.chat.list, { deviceId: "tal-device", connectionId })).messages.map((m) => m.body)).toEqual(["hello"]);
    expect(await code(t.mutation(api.chat.send, { deviceId: "mem-device", connectionId, body: "more" }))).toBe("company_unverified");
    expect((await t.query(api.connections.inbox, { deviceId: "tal-device" })).talent.connected[0].company.verified).toBe(false);
    expect(await code(t.mutation(api.connections.respond, { deviceId: "tal-device", connectionId, accept: false }))).toBe("ok");
    expect(await code(t.mutation(internal.companies.verify, { by: "tony" }))).toBe("invalid");
    expect(await code(t.mutation(internal.companies.verify, { slug: "nope", by: "tony" }))).toBe("not_found");
  });
});

describe("event merge and delete hooks", () => {
  test("merges move connections and host links; deletes drop host links and clear connection events", async () => {
    const { t, acme, past, tal } = await setup();
    const { connectionId } = await t.mutation(api.connections.expressInterest, { deviceId: "tal-device", companyId: acme, eventId: past });
    const [dupe, dupe2] = await t.run(async (ctx) => [
      await ctx.db.insert("events", event("dupe", NOW - 2 * DAY, ["Acme Labs"])),
      await ctx.db.insert("events", event("dupe2", NOW - 2 * DAY, ["Acme Labs"])),
    ]);
    await t.mutation(api.companies.claimEvent, { deviceId: "own-device", companyId: acme, eventId: dupe });
    await t.run(async (ctx) => {
      await reassignEventRefs(ctx, past, dupe);
      await ctx.db.delete(past);
    });
    expect(await t.run(async (ctx) => ({
      connection: (await ctx.db.get(connectionId))!.eventId,
      hosts: (await ctx.db.query("event_hosts").withIndex("by_company", (q) => q.eq("companyId", acme)).collect()).map((h) => h.eventId).sort(),
    }))).toEqual({ connection: dupe, hosts: [dupe, (await t.run((ctx) => ctx.db.query("event_hosts").collect())).find((h) => h.eventId !== dupe && h.companyId === acme)!.eventId].sort() });
    await t.run((ctx) => reassignEventRefs(ctx, dupe, dupe2));
    expect(await t.run((ctx) => ctx.db.query("event_hosts").withIndex("by_event", (q) => q.eq("eventId", dupe2)).collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("event_hosts").withIndex("by_event", (q) => q.eq("eventId", dupe)).collect())).toHaveLength(0);

    await t.mutation(api.connections.respond, { deviceId: "own-device", connectionId, accept: true });
    await t.mutation(api.chat.send, { deviceId: "tal-device", connectionId, body: "still here" });
    await t.run(async (ctx) => {
      await deleteEventRefs(ctx, dupe2);
      await ctx.db.delete(dupe2);
    });
    expect(await t.run((ctx) => ctx.db.query("event_hosts").withIndex("by_event", (q) => q.eq("eventId", dupe2)).collect())).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(connectionId)))!.eventId).toBeUndefined();
    const inbox = await t.query(api.connections.inbox, { deviceId: "tal-device" });
    expect(inbox.talent.connected[0]).toMatchObject({ status: "accepted", event: null });
    expect((await t.query(api.chat.list, { deviceId: "own-device", connectionId })).messages.map((m) => m.body)).toEqual(["still here"]);
    expect(await t.run((ctx) => ctx.db.query("connections").withIndex("by_pair", (q) => q.eq("talentUserId", tal)).collect())).toHaveLength(1);
  });
});
