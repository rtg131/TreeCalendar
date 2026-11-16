import { describe, expect, test } from "vitest";
import { classify, isRelevant } from "./tagger";

const input = (title: string, extra: Partial<Parameters<typeof classify>[0]> = {}) => ({
  title,
  description: "",
  hosts: [],
  sourceTags: [],
  ...extra,
});

describe("rules tagger", () => {
  test("demo days and pitch competitions rank high for investors", () => {
    const demo = classify(input("Berkeley SkyDeck Demo Day", { organizer: "Berkeley SkyDeck" }));
    expect(demo.eventType).toBe("demo_day");
    expect(demo.investorScore).toBeGreaterThanOrEqual(90);
    expect(demo.tags).toEqual(expect.arrayContaining(["pitch", "vc"]));

    const pitch = classify(input("Climate Pitch Competition", { description: "Judged by climate VCs." }));
    expect(pitch.eventType).toBe("pitch_competition");
    expect(pitch.investorScore).toBeGreaterThanOrEqual(80);
  });

  test("VC-hosted events get a hosted-by signal", () => {
    const e = classify(input("Founders at the Table", { hosts: ["Pear VC"] }));
    expect(e.investorSignals).toContain("Hosted by Pear VC");
    expect(e.tags).toContain("vc");
  });

  test("hackathons are tagged for students and developers", () => {
    const e = classify(input("Some Hackathon", { sourceEventType: "hackathon", sourceTags: ["Machine Learning/AI"] }));
    expect(e.eventType).toBe("hackathon");
    expect(e.tags).toEqual(expect.arrayContaining(["hackathons", "ai"]));
    expect(e.audience).toEqual(expect.arrayContaining(["students", "developers"]));
    expect(e.investorScore).toBeLessThan(60);
  });

  test("unrelated social events are dropped", () => {
    expect(isRelevant(classify(input("Beginner Golf Clinic & Social")))).toBe(false);
    expect(isRelevant(classify(input("AI Agents Hack Night")))).toBe(true);
  });

  test("ordinary words do not trigger firm names", () => {
    const e = classify(input("LLM benchmark night", { description: "We appear to pear-program." }));
    expect(e.investorSignals.some((s) => s.includes("Pear"))).toBe(false);
  });
});
