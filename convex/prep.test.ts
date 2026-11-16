import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import type { Briefing, Followup } from "./prepContent";
import { QUESTIONS, TIPS } from "./prepContent";
import type { PrepArgs, PrepareArgs, Prepared } from "./prepStore";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const briefing = makeFunctionReference<"action", PrepArgs, Briefing>("prep:generateBriefing");
const followup = makeFunctionReference<"action", PrepArgs & { recipient: string }, Followup>("prep:generateFollowup");
const get = makeFunctionReference<"query", PrepArgs, { briefing: Briefing | null; followup: Followup | null }>("prep:get");
const seed = makeFunctionReference<"mutation", Record<string, never>, { generated: number }>("prepStore:preGenerateSeed");
const prepare = makeFunctionReference<"mutation", PrepareArgs, Prepared>("prepStore:prepare");

const eventFields = {
  title: "Student Demo Night",
  description: "Build something useful. Speakers include Ada Example and Bo Example. Judges: Cy Example. Sponsored by Example Labs. Hosted by Campus Club.",
  startTime: 1_900_000_000_000,
  timezone: "America/Los_Angeles",
  city: "Stanford",
  venue: "Demo Hall",
  isOnline: false,
  url: "https://example.com/demo",
  source: "fixture",
  sourceId: "demo",
  hosts: ["Campus Club"],
  organizer: "Student Society",
  tags: ["ai"],
  eventType: "demo_day" as const,
  audience: ["students" as const],
  investorScore: 0,
  investorSignals: [],
  lastSeenAt: 1,
};

async function setup() {
  const t = convexTest(schema, modules);
  for (const deviceId of ["alice", "bob"]) {
    await t.mutation(api.users.upsert, {
      deviceId, role: "student", interests: [], city: "Stanford", lat: 37, lng: -122, locationSource: "city",
    });
  }
  const eventId = await t.run((ctx) => ctx.db.insert("events", eventFields));
  return { t, args: { deviceId: "alice", eventId } };
}

beforeEach(() => {
  vi.stubEnv("PREP_API_KEY", "");
  vi.stubEnv("PREP_BASE_URL", "https://prep.invalid/v1");
  vi.stubEnv("PREP_MODEL", "test-model");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected network request")));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("prep cards", () => {
  test("profile and account contact fields never enter cards or model requests", async () => {
    const { t, args } = await setup();
    const privateFields = {
      name: "Private Profile Name", email: "private.profile@example.com", phone: "+1 415 555 0188",
      linkedin: "linkedin.com/in/private-profile", affiliation: "Private Profile Company",
      workEmail: "private.work@example.com", workDomain: "private-work.example.com",
    };
    await t.run(async (ctx) => {
      const user = await ctx.db.query("users").withIndex("by_device", (q) => q.eq("deviceId", args.deviceId)).unique();
      await ctx.db.patch(user!._id, privateFields);
    });
    vi.stubEnv("PREP_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"questions":[0,1]}' } }] }))));
    const card = await t.action(briefing, args);
    const draft = await t.action(followup, { ...args, recipient: "Listed Host" });
    const read = await t.query(get, args);
    const visible = JSON.stringify([card, draft, read, vi.mocked(fetch).mock.calls]);
    for (const value of Object.values(privateFields)) expect(visible).not.toContain(value);
  });

  test("works without a key and uses only verbatim people excerpts and hosts", async () => {
    const { t, args } = await setup();
    expect(await t.query(get, args)).toEqual({ briefing: null, followup: null });
    const value = await t.action(briefing, args);
    expect(value.source).toBe("template");
    expect(value.summary).toBe("Student Demo Night — demo day · Stanford");
    expect(value.people).toEqual([
      "Hosts: “Campus Club; Student Society”",
      "Listing: “Speakers include Ada Example and Bo Example.”", "Listing: “Judges: Cy Example.”",
    ]);
    expect(value.questions).toHaveLength(3);
    expect(value.tip).toBe(TIPS[4]);
    expect(await t.query(get, args)).toEqual({ briefing: value, followup: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("briefings are shared by event, followups are isolated by user and event", async () => {
    const { t, args } = await setup();
    const value = await t.action(briefing, args);
    const aliceDraft = await t.action(followup, { ...args, recipient: "Ada" });
    const bob = { ...args, deviceId: "bob" };
    expect(await t.query(get, bob)).toEqual({ briefing: value, followup: null });
    expect(await t.action(briefing, bob)).toEqual(value);
    const bobDraft = await t.action(followup, { ...bob, recipient: "Bo" });
    expect((await t.query(get, args)).followup).toEqual(aliceDraft);
    expect((await t.query(get, bob)).followup).toEqual(bobDraft);
    const otherEventId = await t.run((ctx) => ctx.db.insert("events", { ...eventFields, sourceId: "other" }));
    expect(await t.query(get, { ...args, eventId: otherEventId })).toEqual({ briefing: null, followup: null });
    const rates = await t.run((ctx) => ctx.db.query("prep_rates").collect());
    expect(rates.map((rate) => rate.requests.length).sort()).toEqual([1, 2]);
  });

  test("keeps hosts separate from unlisted speakers, judges, and sponsors", async () => {
    const { t, args } = await setup();
    await t.run((ctx) => ctx.db.patch(args.eventId, { description: "A student meetup with open discussion." }));
    expect((await t.action(briefing, args)).people).toEqual([
      "Hosts: “Campus Club; Student Society”", "Speakers, judges, and sponsors: not listed",
    ]);
  });

  test("includes mentor and partner evidence verbatim and labels inferred signals", async () => {
    const { t, args } = await setup();
    const sentence = "Mentors from OpenAI and Anthropic, prizes for the best demo, judges include partners at a16z.";
    await t.run((ctx) => ctx.db.patch(args.eventId, {
      title: "AI Agents Hack Night", eventType: "hackathon", description: `Build an autonomous agent in one night. ${sentence}`,
      investorSignals: ["Mentions a16z", "Has a judging panel"],
    }));
    const result = await t.action(briefing, args);
    expect(result.people).toEqual([
      "Hosts: “Campus Club; Student Society”", `Listing: “${sentence}”`, "Inferred signal (not attendance): “Mentions a16z”",
    ]);
    expect(result.tip).toBe(TIPS[3]);
    expect(result.summary).toBe("AI Agents Hack Night — hackathon · Stanford");
  });

  test("caps long evidence to two short excerpts plus a grouped host row", async () => {
    const { t, args } = await setup();
    await t.run((ctx) => ctx.db.patch(args.eventId, {
      description: `Speakers: ${"Name ".repeat(60)}. Judges: Example. Sponsored by Example. Partners: Example.`,
      investorSignals: ["Mentions Example", "Investors mentioned in listing"],
      hosts: ["Campus Club", "Second Club", "Third Club"],
    }));
    const result = await t.action(briefing, args);
    expect(result.people).toHaveLength(3);
    expect(result.people[0]).toBe("Hosts: “Campus Club; Second Club; Third Club; Student Society”");
    expect(result.people[1]).toBe(`Listing: “${`Speakers: ${"Name ".repeat(60)}.`.slice(0, 160)}…”`);
    expect(result.people[2]).toBe("Inferred signal (not attendance): “Mentions Example”");
    expect(result.people.every((item) => item.length < 200)).toBe(true);
  });

  test("investor-signal-only changes invalidate cached cards", async () => {
    const { t, args } = await setup();
    await t.action(briefing, args);
    await t.action(followup, { ...args, recipient: "Ada" });
    await t.run((ctx) => ctx.db.patch(args.eventId, { investorSignals: ["Mentions Pear VC"] }));
    expect(await t.query(get, args)).toEqual({ briefing: null, followup: null });
    expect((await t.action(briefing, args)).people).toContain("Inferred signal (not attendance): “Mentions Pear VC”");
  });

  test("the people section skips format-only signals in favor of named listing evidence", async () => {
    const { t, args } = await setup();
    await t.run((ctx) => ctx.db.patch(args.eventId, { investorSignals: ["Demo day format", "Mentions Example Ventures"] }));
    const result = await t.action(briefing, args);
    expect(result.people).toContain("Inferred signal (not attendance): “Mentions Example Ventures”");
    expect(result.people.join(" ")).not.toContain("Demo day format");
  });

  test.each([
    ["hackathon", 3], ["pitch_competition", 4], ["demo_day", 4], ["networking", 5], ["talk", 0],
  ] as const)("keeps the %s format tip deterministic even if the model requests another", async (eventType, tipIndex) => {
    vi.stubEnv("PREP_API_KEY", "test-prep-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"questions":[0,1],"tip":5}' } }],
    }))));
    const { t, args } = await setup();
    await t.run((ctx) => ctx.db.patch(args.eventId, { eventType }));
    expect(await t.action(briefing, args)).toMatchObject({ source: "model", tip: TIPS[tipIndex] });
  });

  test("recipient edits replace only that user's draft; repeat hits are free", async () => {
    const { t, args } = await setup();
    await t.action(followup, { ...args, recipient: "Ada" });
    const edited = await t.action(followup, { ...args, recipient: "  Bo  " });
    expect(edited.recipient).toBe("Bo");
    expect(edited.linkedin).toContain("Hi Bo,");
    expect(edited.linkedin).not.toContain("Ada");
    expect(edited.email).not.toMatch(/great (meeting|talking)|as (we|you) discussed/i);
    expect((await t.query(get, args)).followup).toEqual(edited);
    await t.action(followup, { ...args, recipient: "Bo" });
    expect(await t.run(async (ctx) => (await ctx.db.query("prep_rates").unique())?.requests.length)).toBe(2);
    expect(await t.run((ctx) => ctx.db.query("prep_followups").collect())).toHaveLength(1);
  });

  test("rejects unknown devices, deleted events, and invalid recipients without network or rate charges", async () => {
    const { t, args } = await setup();
    for (const call of [
      () => t.action(briefing, { ...args, deviceId: "unknown" }),
      () => t.action(followup, { ...args, deviceId: "unknown", recipient: "Ada" }),
    ]) await expect(call()).rejects.toThrow("onboarding");
    expect(await t.query(get, { ...args, deviceId: "unknown" })).toEqual({ briefing: null, followup: null });
    for (const recipient of ["", "   ", "Ada\nBcc: bad", "a".repeat(121)]) {
      await expect(t.action(followup, { ...args, recipient })).rejects.toThrow("Recipient");
    }
    await t.run((ctx) => ctx.db.delete(args.eventId));
    await expect(t.action(briefing, args)).rejects.toThrow("Event not found");
    expect(await t.run((ctx) => ctx.db.query("prep_rates").collect())).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("limits combined cache misses to six per rolling minute and keeps cache hits free", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_900_000_000_000);
    const { t, args } = await setup();
    await t.action(briefing, args);
    for (let index = 0; index < 5; index++) await t.action(followup, { ...args, recipient: `Person ${index}` });
    await expect(t.action(followup, { ...args, recipient: "Seventh" })).rejects.toThrow("rate limit");
    await expect(t.action(briefing, args)).resolves.toMatchObject({ source: "template" });
    await expect(t.action(followup, { ...args, recipient: "Person 4" })).resolves.toMatchObject({ recipient: "Person 4" });
    await expect(t.action(followup, { ...args, deviceId: "bob", recipient: "Separate budget" })).resolves.toBeTruthy();
    vi.advanceTimersByTime(60_100);
    await expect(t.action(followup, { ...args, recipient: "New minute" })).resolves.toBeTruthy();
  });

  test("atomic preparation never permits concurrent misses to exceed the budget", async () => {
    const { t, args } = await setup();
    const results = await Promise.allSettled(Array.from({ length: 9 }, (_, index) =>
      t.mutation(prepare, { ...args, kind: "followup", recipient: `Person ${index}` })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(6);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(3);
    expect(await t.run(async (ctx) => (await ctx.db.query("prep_rates").unique())?.requests.length)).toBe(6);
  });

  test("invalidates both cards on relevant edits, not ingestion timestamps", async () => {
    const { t, args } = await setup();
    const old = await t.action(briefing, args);
    await t.action(followup, { ...args, recipient: "Ada" });
    await t.run((ctx) => ctx.db.patch(args.eventId, { lastSeenAt: 999 }));
    expect((await t.query(get, args)).briefing).toEqual(old);
    await t.run((ctx) => ctx.db.patch(args.eventId, { title: "Updated Demo", hosts: ["New Host"] }));
    expect(await t.query(get, args)).toEqual({ briefing: null, followup: null });
    const updated = await t.action(briefing, args);
    expect(updated.summary).toContain("Updated Demo");
    expect(updated.people).toContain("Hosts: “New Host; Student Society”");
    const draft = await t.action(followup, { ...args, recipient: "Ada" });
    expect(draft.email).toContain("Updated Demo");
    expect(await t.run((ctx) => ctx.db.query("prep_briefings").collect())).toHaveLength(1);
  });

  test("only accepts curated model indexes, never model-written names or prose", async () => {
    vi.stubEnv("PREP_API_KEY", "test-prep-key");
    const mocked = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions: [2, 4], tip: 2, people: ["Invented Person"], summary: "Invented claims" }) } }] })));
    vi.stubGlobal("fetch", mocked);
    const { t, args } = await setup();
    const result = await t.action(briefing, args);
    expect(result).toMatchObject({ source: "model", questions: [QUESTIONS[2], QUESTIONS[4]], tip: TIPS[4] });
    expect(JSON.stringify(result)).not.toContain("Invented");
    const [url, options] = mocked.mock.calls[0];
    expect(url).toBe("https://prep.invalid/v1/chat/completions");
    expect(options.headers.Authorization).toBe("Bearer test-prep-key");
    expect(JSON.parse(options.body).model).toBe("test-model");
    await t.action(briefing, { ...args, deviceId: "bob" });
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  test.each([
    "not json", "null", '{"questions":[0,0],"tip":0}', '{"questions":[0],"tip":0}',
    '{"questions":[0,99],"tip":0}', '{"questions":["0",1],"tip":0}',
    '{"questions":[0,1.5]}', '{"questions":[-1,1]}',
    '{"questions":[0,1,2,3],"tip":0}', '{"summary":"Invented person"}',
  ])("falls back on invalid model selection %s", async (content) => {
    vi.stubEnv("PREP_API_KEY", "test-prep-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content } }] }))));
    const { t, args } = await setup();
    expect((await t.action(briefing, args)).source).toBe("template");
  });

  test.each(["network", "timeout", "http", "body"])("falls back and caches on %s failures", async (failure) => {
    vi.stubEnv("PREP_API_KEY", "test-prep-key");
    const mocked = vi.fn();
    if (failure === "network") mocked.mockRejectedValue(new Error("Provider unavailable"));
    else if (failure === "timeout") mocked.mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    else if (failure === "http") mocked.mockResolvedValue(new Response("Unavailable", { status: 503 }));
    else mocked.mockResolvedValue(new Response("invalid response"));
    vi.stubGlobal("fetch", mocked);
    const { t, args } = await setup();
    const result = await t.action(briefing, args);
    expect(result.source).toBe("template");
    expect(await t.action(briefing, args)).toEqual(result);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  test("does not store or return model results for an event changed in flight", async () => {
    vi.stubEnv("PREP_API_KEY", "test-prep-key");
    const { t, args } = await setup();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      await t.run((ctx) => ctx.db.patch(args.eventId, { title: "Changed during generation" }));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"questions":[0,1],"tip":0}' } }] }));
    }));
    await expect(t.action(briefing, args)).rejects.toThrow("Event changed");
    expect(await t.query(get, args)).toEqual({ briefing: null, followup: null });
  });

  test("seed generation is idempotent, seed-only, refreshes stale entries, and is free", async () => {
    const { t, args } = await setup();
    await t.mutation(internal.seed.run, {});
    const seeds = await t.run((ctx) => ctx.db.query("events").withIndex("by_source_sourceId", (q) => q.eq("source", "seed")).collect());
    expect((await t.mutation(seed, {})).generated).toBe(seeds.length);
    const before = await t.run((ctx) => ctx.db.query("prep_briefings").collect());
    expect((await t.mutation(seed, {})).generated).toBe(0);
    expect(await t.run((ctx) => ctx.db.query("prep_briefings").collect())).toEqual(before);
    expect((await t.query(get, args)).briefing).toBeNull();
    const first = seeds[0] as Doc<"events">;
    expect((await t.query(get, { ...args, eventId: first._id })).briefing?.source).toBe("template");
    await t.run((ctx) => ctx.db.patch(first._id, { description: "Speakers: Newly Listed Person." }));
    expect((await t.mutation(seed, {})).generated).toBe(1);
    expect((await t.query(get, { ...args, eventId: first._id })).briefing?.people).toContain("Listing: “Speakers: Newly Listed Person.”");
    expect(await t.run((ctx) => ctx.db.query("prep_rates").collect())).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
