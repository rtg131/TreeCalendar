import { describe, expect, test } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import { rankEvents } from "./ranking";

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 15, 20);

const event = (id: string, overrides: Partial<Doc<"events">>): Doc<"events"> => ({
  _id: id as Id<"events">,
  _creationTime: 0,
  title: id,
  description: "",
  startTime: now + DAY,
  timezone: "America/Los_Angeles",
  city: "Palo Alto",
  lat: 37.4419,
  lng: -122.143,
  isOnline: false,
  url: "https://example.com",
  source: "seed",
  sourceId: id,
  hosts: [],
  tags: [],
  eventType: "other",
  audience: ["general"],
  investorScore: 5,
  investorSignals: [],
  lastSeenAt: 0,
  ...overrides,
});

const student = { role: "student" as const, interests: ["hackathons", "pitch"], lat: 37.4419, lng: -122.143, now };

describe("ranking", () => {
  test("a nearby matching event this week beats a month-long online hackathon already underway", () => {
    const ranked = rankEvents(
      [
        event("online-hackathon", { isOnline: true, lat: undefined, lng: undefined, startTime: now - 30 * DAY, endTime: now + 10 * DAY, tags: ["hackathons"], eventType: "hackathon" }),
        event("pitch-night", { startTime: now + 2 * DAY, tags: ["pitch"], eventType: "pitch_competition", investorScore: 90 }),
      ],
      student,
    );
    expect(ranked.map((r) => r.event._id)).toEqual(["pitch-night", "online-hackathon"]);
  });

  test("interest match outranks a closer event with no match", () => {
    const ranked = rankEvents(
      [
        event("unmatched-next-door", { tags: ["design"] }),
        event("matched-across-bay", { tags: ["hackathons"], lat: 37.8715, lng: -122.273 }),
      ],
      student,
    );
    expect(ranked[0].event._id).toBe("matched-across-bay");
    expect(ranked[0].matched).toEqual(["hackathons"]);
  });

  test("investors weigh the investor score more heavily", () => {
    const events = [event("social", { tags: ["networking"] }), event("demo-day", { tags: ["networking"], investorScore: 95 })];
    const investor = rankEvents(events, { ...student, role: "investor", interests: ["networking"] });
    expect(investor[0].event._id).toBe("demo-day");
    expect(investor[0].score - investor[1].score).toBeGreaterThan(0.2);
  });
});
