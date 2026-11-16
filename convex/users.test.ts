import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { checkContactField } from "./lib/contact";
import { upsertEvent } from "./lib/store";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const NOW = Date.UTC(2026, 10, 15, 12);
const DAY = 86_400_000;

const base = (deviceId: string, role: "student" | "investor" = "student") => ({
  deviceId, role, interests: ["ai"], city: "San Francisco", lat: 37.7749, lng: -122.4194, locationSource: "city" as const,
});

const alice = {
  ...base("alice-device-secret"),
  name: "Alice Chen", email: "alice.private@stanford.edu", phone: "+1 (415) 555-0100",
  affiliation: "Alicorp Labs", linkedin: "linkedin.com/in/alice-chen-private",
};
const bob = {
  ...base("bob-device-secret", "investor"),
  name: "Bob Ito", email: "bob.private@fund.vc", phone: "+44 20 7946 0958",
  affiliation: "Fund VC", linkedin: "https://www.linkedin.com/in/bob-ito-private/",
};
const ALICE_PII = ["alice-device-secret", "alice.private", "14155550100", "alice-chen-private", "Alice Chen", "Alicorp Labs"];
const PII = [...ALICE_PII, "bob-device-secret", "bob.private", "442079460958", "bob-ito-private", "Bob Ito", "Fund VC"];

describe("contact validation", () => {
  test("normalizes email, phone and LinkedIn and accepts empty optionals", () => {
    expect(checkContactField("email", "  Alice@Stanford.EDU ")).toEqual({ value: "alice@stanford.edu" });
    expect(checkContactField("phone", "+1 (415) 555-0100")).toEqual({ value: "+14155550100" });
    expect(checkContactField("phone", "415 555 0100")).toEqual({ value: "4155550100" });
    expect(checkContactField("linkedin", "https://www.linkedin.com/in/alice-chen/?utm=x")).toEqual({ value: "https://www.linkedin.com/in/alice-chen" });
    expect(checkContactField("linkedin", "@alice-chen")).toEqual({ value: "https://www.linkedin.com/in/alice-chen" });
    expect(checkContactField("name", "  Alice   Chen ")).toEqual({ value: "Alice Chen" });
    for (const field of ["phone", "affiliation", "linkedin"] as const) expect(checkContactField(field, "  ")).toEqual({ value: "" });
  });

  test("rejects bad formats, missing required fields, control characters and long values", () => {
    for (const [field, raw] of [
      ["name", ""], ["email", ""], ["email", "alice"], ["email", "alice@stanford"], ["email", "a b@x.com"],
      ["phone", "555-01"], ["phone", "1234567890123456"], ["phone", "415 CALL NOW"], ["phone", "41+5555555"],
      ["linkedin", "https://twitter.com/in/alice"], ["linkedin", "linkedin.com/company/acme"], ["linkedin", "a b"],
      ["name", "Alice\nChen"], ["name", "x".repeat(81)], ["affiliation", "x".repeat(101)],
      ["email", `${"a".repeat(250)}@x.com`], ["linkedin", "x".repeat(201)],
      ["name", "\u200b"], ["name", "Al\u202eice"], ["name", "A\u0085B"], ["name", "\u2800"], ["affiliation", "Acme\u0000"],
      ["email", "'><script>@x.com"], ["email", "a,b@x.com"], ["email", "a@-b.com"], ["email", "a@[127.0.0.1].com"],
      ["email", `${"İ".repeat(127)}@x.co`], ["phone", "+0000000"], ["linkedin", "%0d%0a-evil"], ["linkedin", "evil.com/?q=linkedin.com/in/x"],
      ["name", "x".repeat(1_000_000)],
    ] as const) expect(checkContactField(field, raw), `${field}: ${raw}`).toHaveProperty("error");
  });

  test("normalization is idempotent", () => {
    for (const [field, raw] of [
      ["email", " Ada@Stanford.EDU "], ["phone", "+1 (415) 555-0100"], ["phone", "415.555.0100"],
      ["linkedin", "https://linkedin.com/in/ada/"], ["name", " Ada  Lovelace "], ["affiliation", " Stanford  GSB "],
    ] as const) {
      const first = checkContactField(field, raw);
      if (!("value" in first)) throw new Error(`${field} rejected`);
      expect(checkContactField(field, first.value)).toEqual(first);
    }
  });
});

describe("users.upsert contact details", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  test("stores normalized details, keeps them when omitted, and clears optionals with an empty string", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.users.upsert, alice);
    expect(await t.query(api.users.get, { deviceId: alice.deviceId })).toMatchObject({
      name: "Alice Chen", email: "alice.private@stanford.edu", phone: "+14155550100",
      affiliation: "Alicorp Labs", linkedin: "https://www.linkedin.com/in/alice-chen-private",
    });
    await t.mutation(api.users.upsert, { ...base(alice.deviceId), radiusKm: 40 });
    expect(await t.query(api.users.get, { deviceId: alice.deviceId })).toMatchObject({ name: "Alice Chen", phone: "+14155550100", radiusKm: 40 });
    await t.mutation(api.users.upsert, { ...base(alice.deviceId), phone: "", linkedin: "" });
    const cleared = await t.query(api.users.get, { deviceId: alice.deviceId });
    expect(cleared).toMatchObject({ name: "Alice Chen", email: "alice.private@stanford.edu", affiliation: "Alicorp Labs" });
    expect(cleared).not.toHaveProperty("phone");
    expect(cleared).not.toHaveProperty("linkedin");
  });

  test("rejects invalid details on write without touching the stored row", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.users.upsert, alice);
    for (const bad of [{ email: "nope" }, { email: "" }, { name: " " }, { phone: "12" }, { linkedin: "facebook.com/alice" }, { affiliation: "x".repeat(101) }]) {
      const error = await t.mutation(api.users.upsert, { ...base(alice.deviceId), ...bad }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConvexError);
      expect((error as ConvexError<{ field: string }>).data.field).toBe(Object.keys(bad)[0]);
    }
    expect(await t.query(api.users.get, { deviceId: alice.deviceId })).toMatchObject({ email: "alice.private@stanford.edu", phone: "+14155550100" });
  });

  test("re-saving the stored profile, as the radius control does, round-trips", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.users.upsert, alice);
    const { _id, _creationTime, updatedAt, ...stored } = (await t.query(api.users.get, { deviceId: alice.deviceId }))!;
    await t.mutation(api.users.upsert, { ...stored, radiusKm: 16 });
    expect(await t.query(api.users.get, { deviceId: alice.deviceId })).toMatchObject({ ...stored, radiusKm: 16 });
  });

  test("a device's own read returns its details and never another user's", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.users.upsert, alice);
    await t.mutation(api.users.upsert, bob);
    const own = JSON.stringify(await t.query(api.users.get, { deviceId: bob.deviceId }));
    expect(own).toContain("bob.private@fund.vc");
    for (const needle of ALICE_PII) expect(own).not.toContain(needle);
    expect(await t.query(api.users.get, { deviceId: "guess" })).toBeNull();
  });

  test("feed, investor, attendance, saves, events and links reads never include email, phone, LinkedIn or deviceIds", async () => {
    const t = convexTest(schema, modules);
    const aliceId = await t.mutation(api.users.upsert, alice);
    const bobId = await t.mutation(api.users.upsert, bob);
    const { id: hackathon } = await t.run((ctx) => upsertEvent(ctx, {
      title: "Stanford student hackathon", description: "", startTime: NOW + 3 * DAY, timezone: "America/Los_Angeles",
      city: "San Francisco", isOnline: false, url: "https://example.com/h", source: "test", sourceId: "h", hosts: [], tags: [],
      eventType: "hackathon", audience: ["students", "developers"], investorScore: 60, investorSignals: ["VC judges"],
    }));
    const seeded = await t.mutation(internal.attendanceSeed.run, { deviceId: alice.deviceId });
    for (const deviceId of [alice.deviceId, bob.deviceId]) {
      await t.mutation(api.saves.toggle, { deviceId, eventId: hackathon });
      await t.mutation(api.attendance.setGoing, { deviceId, eventId: hackathon, going: true });
    }

    const reads = await Promise.all([
      t.query(api.feed.ranked, { deviceId: alice.deviceId }),
      t.query(api.feed.ranked, { deviceId: bob.deviceId }),
      t.query(api.investor.ranked, { deviceId: bob.deviceId }),
      t.query(api.investor.ranked, { deviceId: alice.deviceId }),
      ...[alice.deviceId, bob.deviceId].flatMap((deviceId) => [
        t.query(api.attendance.mine, { deviceId }),
        t.query(api.attendance.pending, { deviceId, now: NOW }),
        t.query(api.attendance.history, { deviceId }),
        t.query(api.saves.list, { deviceId }),
        t.query(api.saves.isSaved, { deviceId, eventId: hackathon }),
      ]),
      ...[hackathon, ...seeded.eventIds].flatMap((eventId) => [t.query(api.attendance.aggregate, { eventId }), t.query(api.events.get, { id: eventId })]),
      t.query(internal.attendance.goingForUser, { userId: aliceId }),
      t.query(internal.attendance.goingForUser, { userId: bobId }),
      t.query(api.events.search, { q: "hackathon" }),
      t.query(api.links.mine, { deviceId: "someone-else" }),
    ]);
    expect((await t.query(api.investor.ranked, { deviceId: bob.deviceId })).events.map((e) => e._id)).toContain(hackathon);
    expect(reads.some((r) => r !== null)).toBe(true);
    const text = JSON.stringify(reads).toLowerCase();
    for (const needle of PII) expect(text).not.toContain(needle.toLowerCase());
  });
});
