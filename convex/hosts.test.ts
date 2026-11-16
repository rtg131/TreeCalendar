import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const NOW = Date.UTC(2026, 10, 15, 12);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW - 10 * DAY);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  vi.stubEnv("EMAIL_DEV_MODE", "1");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("EMAIL_FROM", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const code = (promise: Promise<unknown>) => promise.then(() => "ok", (e: { data?: { code?: string } }) => e.data?.code ?? String(e));
const event = (sourceId: string, startTime: number, hosts: string[], url = `https://example.org/${sourceId}`) => ({
  source: "fixture", sourceId, title: `Event ${sourceId}`, description: "Offline fixture", startTime, endTime: startTime + 2 * HOUR,
  timezone: "America/Los_Angeles", city: "San Francisco", isOnline: false, url, hosts, tags: [],
  eventType: "networking" as const, audience: ["students" as const], investorScore: 0, investorSignals: [], lastSeenAt: 0,
});

function setup() {
  const t = convexTest(schema, modules);
  const profile = (deviceId: string, role: "student" | "investor" | "host", name: string, extra: Record<string, string> = {}) =>
    t.mutation(api.users.upsert, { deviceId, role, interests: [], city: "San Francisco", lat: 37.77, lng: -122.42, locationSource: "city", name, email: `${deviceId}@personal.test`, ...extra });
  const verifyHost = async (deviceId: string, workEmail: string) => {
    const started = await t.action(api.hosts.startVerification, { deviceId, workEmail });
    return t.action(api.hosts.confirmVerification, { deviceId, code: started.devCode! });
  };
  const host = async (deviceId: string, name: string, workEmail: string) => {
    const id = await profile(deviceId, "host", name);
    await verifyHost(deviceId, workEmail);
    return id;
  };
  return { t, profile, verifyHost, host };
}

describe("work email verification", () => {
  test("rejects free mail, accepts .edu and university subdomains, and returns devCode only in dev mode", async () => {
    const { t, profile } = setup();
    await profile("h", "host", "Hana Host");
    for (const email of ["a@gmail.com", "a@Yahoo.co.uk", "a@hotmail.fr", "a@outlook.com", "a@live.com", "a@icloud.com", "a@proton.me", "a@aol.com", "a@gmx.de", "a@yandex.ru", "a@mail.com"]) {
      expect(await code(t.action(api.hosts.startVerification, { deviceId: "h", workEmail: email })), email).toBe("personal_email");
    }
    const started = await t.action(api.hosts.startVerification, { deviceId: "h", workEmail: " Hana@CS.Stanford.edu " });
    expect(started).toMatchObject({ sentTo: "hana@cs.stanford.edu", verificationMode: "dev", expiresAt: NOW - 10 * DAY + 10 * 60_000 });
    expect(started.devCode).toMatch(/^\d{6}$/);
    expect((await t.query(api.hosts.status, { deviceId: "h" })).pending).toEqual({ email: "hana@cs.stanford.edu", expiresAt: started.expiresAt, attemptsLeft: 5, verificationMode: "dev" });
    expect(await t.run((ctx) => ctx.db.query("email_verifications").collect())).toMatchObject([{ email: "hana@cs.stanford.edu", attempts: 0 }]);
    expect(JSON.stringify(await t.run((ctx) => ctx.db.query("email_verifications").collect()))).not.toContain(started.devCode);
    expect(await t.action(api.hosts.confirmVerification, { deviceId: "h", code: started.devCode! })).toEqual({ workEmail: "hana@cs.stanford.edu", workDomain: "cs.stanford.edu", verificationMode: "dev" });
    expect(await t.query(api.hosts.status, { deviceId: "h" })).toEqual({ role: "host", verified: true, workEmail: "hana@cs.stanford.edu", workDomain: "cs.stanford.edu", verificationMode: "dev", pending: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("throws email_not_configured without a sender, and picks Resend when its env is set", async () => {
    const { t, profile } = setup();
    await profile("h", "host", "Hana Host");
    vi.stubEnv("EMAIL_DEV_MODE", "");
    expect(await code(t.action(api.hosts.startVerification, { deviceId: "h", workEmail: "hana@acme.dev" }))).toBe("email_not_configured");
    expect(await t.run((ctx) => ctx.db.query("email_verifications").collect())).toEqual([]);

    vi.stubEnv("EMAIL_DEV_MODE", "1");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Scout <verify@scout.test>");
    const sent = await t.action(api.hosts.startVerification, { deviceId: "h", workEmail: "hana@acme.dev" });
    expect(sent).toEqual({ sentTo: "hana@acme.dev", expiresAt: expect.any(Number), verificationMode: "email" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({ from: "Scout <verify@scout.test>", to: ["hana@acme.dev"] });
    const mailed = body.text.match(/\d{6}/)[0];
    expect(await t.action(api.hosts.confirmVerification, { deviceId: "h", code: mailed })).toMatchObject({ verificationMode: "email" });
    expect((await t.query(api.hosts.status, { deviceId: "h" })).verificationMode).toBe("email");
    await t.action(api.hosts.startVerification, { deviceId: "h", workEmail: "hana@acme.dev" });
    expect((await t.query(api.hosts.status, { deviceId: "h" })).pending).toMatchObject({ verificationMode: "email" });

    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect(await code(t.action(api.hosts.startVerification, { deviceId: "h", workEmail: "hana@acme.dev" }))).toBe("email_send_failed");
    expect(await t.run((ctx) => ctx.db.query("email_verifications").collect())).toHaveLength(1);
  });

  test("wrong codes change nothing, five attempts lock the code, and codes expire after 10 minutes", async () => {
    const { t, profile } = setup();
    const id = await profile("h", "host", "Hana Host");
    const before = await t.run((ctx) => ctx.db.get(id));
    const { devCode } = await t.action(api.hosts.startVerification, { deviceId: "h", workEmail: "hana@acme.dev" });
    const wrong = devCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) expect(await code(t.action(api.hosts.confirmVerification, { deviceId: "h", code: wrong }))).toBe("invalid_code");
    expect(await t.run((ctx) => ctx.db.get(id))).toEqual(before);
    expect((await t.query(api.hosts.status, { deviceId: "h" })).pending).toMatchObject({ attemptsLeft: 1 });
    expect(await code(t.action(api.hosts.confirmVerification, { deviceId: "h", code: wrong }))).toBe("too_many_attempts");
    expect(await code(t.action(api.hosts.confirmVerification, { deviceId: "h", code: devCode! }))).toBe("too_many_attempts");
    expect(await t.run((ctx) => ctx.db.get(id))).toEqual(before);

    const fresh = await t.action(api.hosts.startVerification, { deviceId: "h", workEmail: "hana@acme.dev" });
    vi.setSystemTime(NOW - 10 * DAY + 10 * 60_000 + 1);
    expect(await code(t.action(api.hosts.confirmVerification, { deviceId: "h", code: fresh.devCode! }))).toBe("code_expired");
    expect(await code(t.action(api.hosts.confirmVerification, { deviceId: "h", code: "12ab56" }))).toBe("invalid_code");
    expect((await t.query(api.hosts.status, { deviceId: "h" })).verified).toBe(false);
  });

  test("limits sends to 3 an hour per device and per address, and requires the host role", async () => {
    const { t, profile } = setup();
    await profile("h", "host", "Hana Host");
    await profile("h2", "host", "Hugo Host");
    await profile("s", "student", "Sam Student");
    expect(await code(t.action(api.hosts.startVerification, { deviceId: "s", workEmail: "sam@acme.dev" }))).toBe("host_required");
    for (const email of ["a@acme.dev", "b@acme.dev", "c@acme.dev"]) await t.action(api.hosts.startVerification, { deviceId: "h", workEmail: email });
    expect(await code(t.action(api.hosts.startVerification, { deviceId: "h", workEmail: "d@acme.dev" }))).toBe("rate_limited");
    for (let i = 0; i < 2; i++) await t.action(api.hosts.startVerification, { deviceId: "h2", workEmail: "a@acme.dev" });
    expect(await code(t.action(api.hosts.startVerification, { deviceId: "h2", workEmail: "a@acme.dev" }))).toBe("rate_limited");
    vi.setSystemTime(NOW - 10 * DAY + HOUR + 1);
    expect(await code(t.action(api.hosts.startVerification, { deviceId: "h", workEmail: "d@acme.dev" }))).toBe("ok");
  });

  test("never reveals whether an address belongs to another account, and upsert keeps work email fields", async () => {
    const { t, host, profile } = setup();
    await host("first", "First Host", "shared@acme.dev");
    await profile("second", "host", "Second Host");
    await profile("third", "host", "Third Host");
    const taken = await t.action(api.hosts.startVerification, { deviceId: "second", workEmail: "shared@acme.dev" });
    const free = await t.action(api.hosts.startVerification, { deviceId: "third", workEmail: "nobody@acme.dev" });
    expect(Object.keys(taken).sort()).toEqual(Object.keys(free).sort());
    expect(taken).toMatchObject({ sentTo: "shared@acme.dev", verificationMode: "dev" });

    await t.mutation(api.users.upsert, { deviceId: "first", role: "host", interests: ["ai"], city: "Oakland", lat: 0, lng: 0, locationSource: "city" });
    expect(await t.query(api.hosts.status, { deviceId: "first" })).toMatchObject({ verified: true, workEmail: "shared@acme.dev" });
  });
});

describe("domain-verified companies and joining", () => {
  test("a verified host's company is domain-verified; .edu companies wait for an admin; same-domain hosts request to join", async () => {
    const { t, host } = setup();
    await host("ana", "Ana", "ana@acme.dev");
    await host("ben", "Ben", "ben@acme.dev");
    await host("cal", "Cal", "cal@other.dev");
    await host("club", "Club Lead", "lead@cs.stanford.edu");
    const acme = await t.mutation(api.companies.create, { deviceId: "ana", name: "Acme" });
    expect(await t.run((ctx) => ctx.db.get(acme))).toMatchObject({ domain: "acme.dev", verifiedBy: "domain:dev", verifiedAt: expect.any(Number) });
    expect((await t.query(api.companies.mine, { deviceId: "ana" })).memberships[0].company.verified).toBe(true);

    const club = await t.mutation(api.companies.create, { deviceId: "club", name: "Stanford Robotics Club" });
    const clubDoc = await t.run((ctx) => ctx.db.get(club));
    expect([clubDoc!.verifiedAt, clubDoc!.domain]).toEqual([undefined, undefined]);
    await t.mutation(internal.companies.verify, { slug: "stanford-robotics-club", by: "tony" });
    expect((await t.query(api.companies.mine, { deviceId: "club" })).memberships[0].company.verified).toBe(true);

    await expect(t.mutation(api.companies.create, { deviceId: "ben", name: "Acme Two" })).rejects.toMatchObject({ data: { code: "domain_taken", companyId: acme } });
    expect(await t.query(api.companies.forMyDomain, { deviceId: "ben" })).toMatchObject({ company: { _id: acme }, membership: null, requested: false });
    expect(await code(t.mutation(api.companies.requestJoin, { deviceId: "cal", companyId: acme }))).toBe("forbidden");
    await t.mutation(api.companies.requestJoin, { deviceId: "ben", companyId: acme });
    const asOwner = await t.query(api.companies.get, { deviceId: "ana", companyId: acme });
    expect(asOwner!.joinRequests).toMatchObject([{ name: "Ben", workEmail: "ben@acme.dev" }]);
    expect(await code(t.mutation(api.companies.respondJoin, { deviceId: "cal", companyId: acme, userId: asOwner!.joinRequests![0].userId, accept: true }))).toBe("forbidden");
    await t.mutation(api.companies.respondJoin, { deviceId: "ana", companyId: acme, userId: asOwner!.joinRequests![0].userId, accept: true });
    expect((await t.query(api.companies.mine, { deviceId: "ben" })).memberships).toMatchObject([{ role: "member", company: { _id: acme } }]);

    const ownerless = await t.run((ctx) => ctx.db.insert("companies", { name: "Other", slug: "other", domain: "other.dev", createdAt: NOW, verifiedAt: NOW, verifiedBy: "tony" }));
    await t.mutation(api.companies.requestJoin, { deviceId: "cal", companyId: ownerless });
    const cal = (await t.run((ctx) => ctx.db.query("users").withIndex("by_device", (q) => q.eq("deviceId", "cal")).unique()))!;
    await t.mutation(internal.companies.approveJoin, { companyId: ownerless, userId: cal._id });
    expect((await t.query(api.companies.mine, { deviceId: "cal" })).memberships).toMatchObject([{ company: { _id: ownerless } }]);
  });

  test("invites are accepted only by verified hosts whose verified work email matches", async () => {
    const { t, host, profile } = setup();
    await host("ana", "Ana", "ana@acme.dev");
    const acme = await t.mutation(api.companies.create, { deviceId: "ana", name: "Acme" });
    await profile("squat", "host", "Squatter", { email: "dee@acme.dev" });
    await t.mutation(api.companies.invite, { deviceId: "ana", companyId: acme, email: "dee@acme.dev" });
    expect(await code(t.mutation(api.companies.respondInvite, { deviceId: "squat", companyId: acme, accept: true }))).toBe("host_required");
    expect((await t.query(api.companies.mine, { deviceId: "squat" })).invites).toEqual([]);
    await host("dee", "Dee", "dee@acme.dev");
    expect((await t.query(api.companies.mine, { deviceId: "dee" })).invites).toMatchObject([{ company: { _id: acme } }]);
    await t.mutation(api.companies.respondInvite, { deviceId: "dee", companyId: acme, accept: true });
    expect((await t.query(api.companies.mine, { deviceId: "dee" })).memberships).toHaveLength(1);
  });
});

async function world() {
  const base = setup();
  const { t, host, profile } = base;
  const ana = await host("ana", "Ana", "ana@acme.dev");
  const ben = await host("ben", "Ben", "ben@acme.dev");
  const acme = await t.mutation(api.companies.create, { deviceId: "ana", name: "Acme" });
  await t.mutation(api.companies.requestJoin, { deviceId: "ben", companyId: acme });
  await t.mutation(api.companies.respondJoin, { deviceId: "ana", companyId: acme, userId: ben, accept: true });
  const talent = async (deviceId: string, name: string) => profile(deviceId, "student", name, { phone: "+1 415 555 0100", linkedin: `linkedin.com/in/${deviceId}-secret`, affiliation: "Cal" });
  const [zoe, amy, kim, lee] = [await talent("zoe", "Zoe"), await talent("amy", "Amy"), await talent("kim", "Kim"), await talent("lee", "Lee")];
  const [named, onDomain, unrelated, upcoming] = await t.run(async (ctx) => [
    await ctx.db.insert("events", event("named", NOW - 9 * DAY, ["Acme"])),
    await ctx.db.insert("events", { ...event("domain", NOW - 9 * DAY, ["Someone"], "https://lu.ma/x"), sources: [{ url: "https://events.acme.dev/meetup", source: "ical", sourceId: "m" }] }),
    await ctx.db.insert("events", event("unrelated", NOW - 9 * DAY, ["Someone Else"])),
    await ctx.db.insert("events", event("upcoming", NOW + 5 * DAY, ["Someone Else"])),
  ]);
  await t.run(async (ctx) => {
    for (const userId of [zoe, amy, kim, lee]) for (const eventId of [named, unrelated, upcoming]) await ctx.db.insert("attendance", { userId, eventId, going: true });
  });
  vi.setSystemTime(NOW);
  return { ...base, ana, ben, acme, zoe, amy, kim, lee, named, onDomain, unrelated, upcoming };
}

describe("event hosting claims", () => {
  test("auto-approves by host name or by the company's verified domain", async () => {
    const { t, acme, named, onDomain } = await world();
    expect(await t.query(api.hosts.hostingStatus, { deviceId: "ana", eventId: named })).toEqual({ canClaim: true, claim: null });
    expect(await t.mutation(api.hosts.claimHosting, { deviceId: "ana", eventId: named })).toMatchObject({ status: "approved", companyId: acme });
    expect(await t.mutation(api.hosts.claimHosting, { deviceId: "ben", eventId: onDomain, companyId: acme })).toMatchObject({ status: "approved" });
    expect(await t.query(api.hosts.hostingStatus, { deviceId: "ben", eventId: named })).toMatchObject({ canClaim: false, claim: { status: "approved", companyId: acme } });
  });

  test("other claims stay pending with no access until a same-domain member or an admin approves", async () => {
    const { t, acme, unrelated, upcoming, zoe } = await world();
    const pending = await t.mutation(api.hosts.claimHosting, { deviceId: "ana", eventId: unrelated });
    expect(pending.status).toBe("pending");
    expect(await t.query(api.hosts.hostingStatus, { deviceId: "ana", eventId: unrelated })).toMatchObject({ canClaim: false, claim: { status: "pending" } });
    expect(await code(t.query(api.hosts.eventMatches, { deviceId: "ana", eventId: unrelated, companyId: acme }))).toBe("forbidden");
    expect(await code(t.mutation(api.connections.expressInterest, { deviceId: "zoe", companyId: acme, eventId: unrelated }))).toBe("not_eligible");
    expect(await code(t.query(api.connections.talentProfile, { deviceId: "ana", companyId: acme, talentUserId: zoe }))).toBe("not_found");
    expect((await t.query(api.companies.get, { deviceId: "ana", companyId: acme }))!).toMatchObject({ hostedEvents: [], pendingClaims: [{ claimId: pending.claimId, requestedByName: "Ana", canReview: false }] });
    expect((await t.query(api.companies.get, { deviceId: "ben", companyId: acme }))!.pendingClaims).toMatchObject([{ claimId: pending.claimId, canReview: true }]);
    expect((await t.query(api.hosts.hostingStatus, { deviceId: "ben", eventId: unrelated })).claim).toMatchObject({ status: "pending", canReview: true });
    expect((await t.query(api.hosts.hostingStatus, { deviceId: "ana", eventId: unrelated })).claim).toMatchObject({ status: "pending", canReview: false });
    expect(await code(t.mutation(api.hosts.reviewClaim, { deviceId: "ana", claimId: pending.claimId, approve: true }))).toBe("forbidden");
    await t.mutation(api.hosts.reviewClaim, { deviceId: "ben", claimId: pending.claimId, approve: true });
    expect((await t.query(api.hosts.eventMatches, { deviceId: "ana", eventId: unrelated, companyId: acme })).matches).toHaveLength(4);

    const later = await t.mutation(api.hosts.claimHosting, { deviceId: "ben", eventId: upcoming });
    expect(later.status).toBe("pending");
    await t.mutation(internal.companies.approveClaim, { claimId: later.claimId });
    expect(await t.query(api.hosts.hostingStatus, { deviceId: "ana", eventId: upcoming })).toMatchObject({ claim: { status: "approved" } });
  });

  test("eventMatches lists mutual matches first, then interested talent, then attendees, with contact gated", async () => {
    const { t, acme, named, zoe, amy, kim, lee } = await world();
    await t.mutation(api.hosts.claimHosting, { deviceId: "ana", eventId: named });
    const mutual = await t.mutation(api.connections.expressInterest, { deviceId: "lee", companyId: acme, eventId: named });
    await t.mutation(api.connections.respond, { deviceId: "ben", connectionId: mutual.connectionId, accept: true });
    await t.mutation(api.connections.expressInterest, { deviceId: "zoe", companyId: acme, eventId: named });
    await t.mutation(api.connections.expressInterestInTalent, { deviceId: "ana", companyId: acme, talentUserId: kim, eventId: named });
    const toAmy = await t.mutation(api.connections.expressInterestInTalent, { deviceId: "ana", companyId: acme, talentUserId: amy, eventId: named });
    await t.mutation(api.connections.respond, { deviceId: "amy", connectionId: toAmy.connectionId, accept: false });
    const result = await t.query(api.hosts.eventMatches, { deviceId: "ben", eventId: named, companyId: acme });
    expect(result.event).toMatchObject({ _id: named });
    expect(result.matches.map((m) => [m.talent.userId, m.connection?.status ?? null, m.interested, m.mutual])).toEqual([
      [lee, "accepted", true, true], [zoe, "pending", true, false], [kim, "pending", false, false], [amy, null, false, false],
    ]);
    expect(result.matches.map((m) => m.blockedUntil)).toEqual([null, null, null, expect.closeTo(NOW + 30 * DAY, -3)]);
    expect((await t.query(api.hosts.hostingStatus, { deviceId: "ana", eventId: named })).claim).toMatchObject({ status: "approved", canReview: false });
    expect(result.matches[0]).toMatchObject({ talent: { name: "Lee", affiliation: "Cal", priorRoles: null }, attended: true, contact: null });
    expect(JSON.stringify(result)).not.toMatch(/secret|14155550100|personal\.test|"zoe"|"lee"/);
    await t.mutation(api.connections.setShareContact, { deviceId: "lee", connectionId: mutual.connectionId, shareContact: true });
    expect((await t.query(api.hosts.eventMatches, { deviceId: "ben", eventId: named, companyId: acme })).matches[0].contact)
      .toEqual({ email: "lee@personal.test", phone: "+14155550100", linkedin: "https://www.linkedin.com/in/lee-secret", affiliation: "Cal" });
  });

  test("non-hosts get host_required everywhere on the company side, and unverified companies are rejected", async () => {
    const { t, profile, host, acme, named, zoe, ana } = await world();
    await t.mutation(api.hosts.claimHosting, { deviceId: "ana", eventId: named });
    const { connectionId } = await t.mutation(api.connections.expressInterest, { deviceId: "zoe", companyId: acme, eventId: named });
    await t.mutation(api.connections.respond, { deviceId: "ana", connectionId, accept: true });
    await t.mutation(api.users.upsert, { deviceId: "ana", role: "investor", interests: [], city: "SF", lat: 0, lng: 0, locationSource: "city" });
    await profile("inv", "investor", "Ivan Investor");
    const calls = (deviceId: string): Record<string, Promise<unknown>> => ({
      create: t.mutation(api.companies.create, { deviceId, name: "Anything" }),
      invite: t.mutation(api.companies.invite, { deviceId, companyId: acme, email: "x@acme.dev" }),
      respondInvite: t.mutation(api.companies.respondInvite, { deviceId, companyId: acme, accept: true }),
      claimEvent: t.mutation(api.companies.claimEvent, { deviceId, companyId: acme, eventId: named }),
      claimable: t.query(api.companies.claimable, { deviceId, companyId: acme }),
      requestJoin: t.mutation(api.companies.requestJoin, { deviceId, companyId: acme }),
      eventTalent: t.query(api.connections.eventTalent, { deviceId, companyId: acme, eventId: named }),
      talentProfile: t.query(api.connections.talentProfile, { deviceId, companyId: acme, talentUserId: zoe }),
      expressInterestInTalent: t.mutation(api.connections.expressInterestInTalent, { deviceId, companyId: acme, talentUserId: zoe, eventId: named }),
      claimHosting: t.mutation(api.hosts.claimHosting, { deviceId, eventId: named, companyId: acme }),
      eventMatches: t.query(api.hosts.eventMatches, { deviceId, eventId: named, companyId: acme }),
    });
    for (const deviceId of ["ana", "inv"]) {
      for (const [name, call] of Object.entries(calls(deviceId))) expect(await code(call), `${deviceId} ${name}`).toBe("host_required");
    }
    expect(await code(t.mutation(api.connections.respond, { deviceId: "ana", connectionId, accept: false }))).toBe("host_required");
    expect(await code(t.mutation(api.chat.send, { deviceId: "ana", connectionId, body: "hi" }))).toBe("host_required");
    expect(await code(t.query(api.chat.list, { deviceId: "ana", connectionId }))).toBe("host_required");
    expect((await t.query(api.connections.inbox, { deviceId: "ana" })).companies).toEqual([]);
    expect((await t.query(api.hosts.hostingStatus, { deviceId: "ana", eventId: named }))).toEqual({ canClaim: false, claim: null });
    expect(ana).toBeDefined();

    await host("club", "Club", "lead@cs.stanford.edu");
    const club = await t.mutation(api.companies.create, { deviceId: "club", name: "Robotics Club" });
    expect(await code(t.mutation(api.hosts.claimHosting, { deviceId: "club", eventId: named }))).toBe("company_unverified");
    expect(await code(t.query(api.hosts.eventMatches, { deviceId: "club", eventId: named, companyId: club as Id<"companies"> }))).toBe("company_unverified");
  });
});
