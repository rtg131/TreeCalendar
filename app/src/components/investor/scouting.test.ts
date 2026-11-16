import { describe, expect, it } from "vitest";
import type { Id } from "../../../../convex/_generated/dataModel";
import { applyFilters, schoolsIn, weekShortlist, type InvestorEvent } from "./scouting";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 15, 18);

let n = 0;
const ev = (over: Partial<InvestorEvent>): InvestorEvent => ({
  _id: `e${n++}` as Id<"events">,
  _creationTime: 0,
  title: "Event",
  description: "",
  startTime: NOW + DAY,
  timezone: "America/Los_Angeles",
  city: "San Francisco",
  isOnline: false,
  url: "https://example.com",
  source: "seed",
  sourceId: String(n),
  hosts: [],
  tags: [],
  eventType: "networking",
  audience: ["students"],
  investorScore: 30,
  investorSignals: [],
  lastSeenAt: 0,
  school: null,
  studentDensity: 0.5,
  scoutScore: 50,
  reasons: [],
  ...over,
});

const pitch = ev({ title: "Stanford Pitch Night", eventType: "pitch_competition", school: "Stanford", investorScore: 95, startTime: NOW + 2 * DAY });
const demo = ev({ title: "SkyDeck Demo Day", eventType: "demo_day", school: "UC Berkeley", investorScore: 100, startTime: NOW + 9 * DAY });
const hack = ev({ title: "TreeHacks", eventType: "hackathon", school: "Stanford", investorScore: 25, startTime: NOW + 12 * DAY });
const ongoing = ev({ title: "Month-long hackathon", eventType: "hackathon", investorScore: 80, startTime: NOW - 3 * DAY, endTime: NOW + 20 * DAY });
const list = [pitch, demo, hack, ongoing];

describe("investor filters", () => {
  it("filters by school, grouped type, and date", () => {
    expect(applyFilters(list, { school: "Stanford", type: "all", date: "any" }, NOW)).toEqual([pitch, hack]);
    expect(applyFilters(list, { school: null, type: "pitch", date: "any" }, NOW)).toEqual([pitch, demo]);
    expect(applyFilters(list, { school: null, type: "all", date: "week" }, NOW)).toEqual([pitch, ongoing]);
  });

  it("shortlists high-signal events starting this week, skipping long-running ones already underway", () => {
    expect(weekShortlist(list, NOW)).toEqual([pitch]);
  });

  it("lists schools present in the results in a stable order", () => {
    expect(schoolsIn(list)).toEqual(["Stanford", "UC Berkeley"]);
  });
});
