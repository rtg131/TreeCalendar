import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { inferSchool, scout, studentDensity } from "./lib/scouting";
import { upsertEvent } from "./lib/store";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const DAY = 86_400_000;

const investorUser = {
  deviceId: "investor-1",
  role: "investor" as const,
  interests: ["ai"],
  city: "San Francisco",
  lat: 37.7749,
  lng: -122.4194,
  locationSource: "city" as const,
};

type Overrides = Partial<{
  title: string;
  description: string;
  venue: string;
  organizer: string;
  hosts: string[];
  eventType: "hackathon" | "pitch_competition" | "networking" | "social" | "talk";
  audience: ("students" | "founders" | "investors" | "developers" | "general")[];
  investorScore: number;
  investorSignals: string[];
  startTime: number;
  endTime: number;
}>;

const normalized = (sourceId: string, o: Overrides = {}) => ({
  title: `Event ${sourceId}`,
  description: "",
  startTime: Date.now() + 3 * DAY,
  timezone: "America/Los_Angeles",
  city: "San Francisco",
  isOnline: false,
  url: `https://example.com/${sourceId}`,
  source: "test",
  sourceId,
  hosts: [],
  tags: [],
  eventType: "social" as const,
  audience: [],
  investorScore: 0,
  investorSignals: [],
  ...o,
});

const studentHackathon = (sourceId: string, o: Overrides = {}) =>
  normalized(sourceId, {
    title: "TreeHacks Spring Build",
    eventType: "hackathon",
    audience: ["students", "developers"],
    investorScore: 50,
    investorSignals: ["VC judges", "Sponsor: a16z", "Demo day"],
    ...o,
  });

async function withEvents(events: ReturnType<typeof normalized>[]) {
  const t = convexTest(schema, modules);
  await t.mutation(api.users.upsert, investorUser);
  await t.run(async (ctx) => {
    for (const event of events) await upsertEvent(ctx, event);
  });
  return t;
}

const titles = (r: { events: { sourceId: string }[] }) => r.events.map((e) => e.sourceId);

afterEach(() => {
  vi.useRealTimers();
});

describe("scouting rules", () => {
  test("school comes from the title, venue, organizer, hosts or city before the description", () => {
    expect(inferSchool(normalized("a", { title: "Cal Hacks 12.0" }))).toBe("UC Berkeley");
    expect(inferSchool(normalized("b", { venue: "Huang Engineering Center" }))).toBe("Stanford");
    expect(inferSchool(normalized("c", { description: "Held near SJSU", venue: "Leavey Center" }))).toBe("Santa Clara");
    expect(inferSchool(normalized("d", { description: "Students from SF State welcome" }))).toBe("SF State");
    expect(inferSchool(normalized("e", { title: "Founder dinner" }))).toBeNull();
  });

  test("student density adds up the signals and caps at 1", () => {
    expect(studentDensity(normalized("a"))).toBe(0);
    expect(studentDensity(normalized("b", { audience: ["students"] }))).toBe(0.35);
    expect(studentDensity(normalized("c", { title: "Campus club mixer" }))).toBe(0.15);
    const full = normalized("d", {
      title: "Stanford student hackathon",
      audience: ["students"],
      eventType: "hackathon",
    });
    expect(studentDensity(full)).toBe(1);
  });

  test("scoutScore blends investor score, density and soonness, and reasons lead with two investor signals", () => {
    const now = Date.now();
    const s = scout({ ...studentHackathon("a"), startTime: now }, now);
    expect(s.school).toBe("Stanford");
    expect(s.studentDensity).toBe(0.7);
    expect(s.scoutScore).toBe(Math.round(100 * (0.55 * 0.5 + 0.3 * 0.7 + 0.15 * 1)));
    expect(s.reasons).toEqual(["VC judges", "Sponsor: a16z", "Student hackathon at Stanford"]);
    expect(scout(normalized("b", { audience: ["students"], title: "Student founders night" }), now).reasons).toEqual([
      "Student crowd expected",
    ]);
  });
});

describe("ingest", () => {
  test("upsertEvent stores school and studentDensity", async () => {
    const t = await withEvents([studentHackathon("a"), normalized("b")]);
    const stored = await t.run((ctx) => ctx.db.query("events").collect());
    expect(stored.map((e) => [e.sourceId, e.school, e.studentDensity])).toEqual([
      ["a", "Stanford", 0.7],
      ["b", undefined, 0],
    ]);
  });
});

describe("investor.ranked", () => {
  test("returns student events only, ordered by scoutScore then start time, with full event fields", async () => {
    const now = Date.now();
    const t = await withEvents([
      studentHackathon("strong", { investorScore: 90, startTime: now + 2 * DAY }),
      studentHackathon("tie-late", { startTime: now + 5 * DAY, investorScore: 50 }),
      studentHackathon("tie-early", { startTime: now + 5 * DAY - 1, investorScore: 50 }),
      normalized("not-students", { investorScore: 100, eventType: "networking" }),
      studentHackathon("ended", { startTime: now - 3 * DAY, endTime: now - 2 * DAY }),
    ]);
    const result = await t.query(api.investor.ranked, { deviceId: investorUser.deviceId });
    expect(titles(result)).toEqual(["strong", "tie-early", "tie-late"]);
    const top = result.events[0];
    expect(top).toMatchObject({
      school: "Stanford",
      studentDensity: 0.7,
      investorSignals: ["VC judges", "Sponsor: a16z", "Demo day"],
      hosts: [],
      description: "",
      reasons: ["VC judges", "Sponsor: a16z", "Student hackathon at Stanford"],
    });
    expect(top.scoutScore).toBeGreaterThan(result.events[1].scoutScore);
    expect(top._id).toBeDefined();
  });

  test("filters by school, eventType and the from/to window", async () => {
    const now = Date.now();
    const t = await withEvents([
      studentHackathon("stanford-hack", { startTime: now + 2 * DAY }),
      studentHackathon("berkeley-pitch", { title: "Berkeley SkyDeck pitch night", eventType: "pitch_competition", startTime: now + 10 * DAY }),
      studentHackathon("berkeley-hack", { title: "Cal Hacks", startTime: now + 20 * DAY }),
    ]);
    const q = (args: object) => t.query(api.investor.ranked, { deviceId: investorUser.deviceId, ...args }).then(titles);
    expect((await q({})).sort()).toEqual(["berkeley-hack", "berkeley-pitch", "stanford-hack"]);
    expect((await q({ school: "UC Berkeley" })).sort()).toEqual(["berkeley-hack", "berkeley-pitch"]);
    expect(await q({ school: "UC Berkeley", eventType: "hackathon" })).toEqual(["berkeley-hack"]);
    expect(await q({ eventType: "pitch_competition" })).toEqual(["berkeley-pitch"]);
    expect((await q({ from: now + 5 * DAY, to: now + 15 * DAY }))).toEqual(["berkeley-pitch"]);
    expect(await q({ school: "UCSF" })).toEqual([]);
  });

  test("returns no events for an unknown device", async () => {
    const t = await withEvents([studentHackathon("a")]);
    expect(await t.query(api.investor.ranked, { deviceId: "nobody" })).toEqual({ events: [] });
  });
});

describe("backfillScouting", () => {
  test("fills school and studentDensity on existing events across pages", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.mutation(api.users.upsert, investorUser);
    await t.run(async (ctx) => {
      for (let i = 0; i < 205; i++) {
        await ctx.db.insert("events", { ...normalized(`plain-${i}`), lastSeenAt: Date.now() });
      }
      await ctx.db.insert("events", { ...studentHackathon("legacy"), lastSeenAt: Date.now() });
    });
    expect(await t.query(api.investor.ranked, { deviceId: investorUser.deviceId, school: "Stanford" })).toEqual({ events: [] });

    const first = await t.mutation(internal.investor.backfillScouting, {});
    expect(first.isDone).toBe(false);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const stored = await t.run((ctx) => ctx.db.query("events").collect());
    expect(stored.every((e) => e.studentDensity !== undefined)).toBe(true);
    expect(stored.find((e) => e.sourceId === "legacy")).toMatchObject({ school: "Stanford", studentDensity: 0.7 });
    expect(titles(await t.query(api.investor.ranked, { deviceId: investorUser.deviceId, school: "Stanford" }))).toEqual(["legacy"]);
    expect(await t.mutation(internal.investor.backfillScouting, {})).toEqual({ updated: 0, isDone: false });
  });
});
