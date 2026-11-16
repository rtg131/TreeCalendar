import { describe, expect, test } from "vitest";
import expected from "../../fixtures/mlh/season-2027-events.expected.json";
import html from "../../fixtures/mlh/season-2027-events.html?raw";
import { mlhAdapter, parseMlhSeasonPage } from "./mlh";

describe("mlh adapter", () => {
  test("parses the saved 2027 season page into RawEvents", () => {
    expect(parseMlhSeasonPage(html)).toEqual(expected);
  });

  test("keeps in-person and hybrid events with UTC dates, city and country", () => {
    const events = parseMlhSeasonPage(html);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.location.online).toBe(false);
      expect(e.startsAt).toMatch(/\+00:00$/);
      expect(Date.parse(e.endsAt!)).toBeGreaterThan(Date.parse(e.startsAt));
      expect(e.location.city).toBeTruthy();
      expect(e.location.country).toMatch(/^[A-Z]{2}$/);
      expect(e.url).not.toMatch(/utm_/);
    }
    expect(events.find((e) => e.title === "NASA's Space Apps Challenge NYC")).toMatchObject({
      description: "Hybrid MLH member hackathon in Brooklyn, New York.",
      location: { city: "Brooklyn", region: "New York", country: "US" },
    });
  });

  test("drops digital events and events without dates", () => {
    const page = { props: { upcomingEvents: [
      { id: "a", name: "Online Jam", startsAt: "2027-01-01T00:00:00Z", endsAt: "2027-01-02T00:00:00Z", formatType: "digital" },
      { id: "b", name: "No Dates", startsAt: null, endsAt: null, formatType: "physical" },
      { id: "c", name: " Kept ", startsAt: "2027-01-01T00:00:00Z", endsAt: "2027-01-02T00:00:00Z", formatType: "hybrid_physical", url: "/events/c", venueAddress: { city: " Cincinnati ", state: "Ohio", country: "US" } },
    ] } };
    const events = parseMlhSeasonPage('<script data-page="app" type="application/json">' + JSON.stringify(page) + "</script>");
    expect(events.map((e) => [e.sourceId, e.title, e.url, e.location.city])).toEqual([["c", "Kept", "https://www.mlh.com/events/c", "Cincinnati"]]);
  });

  test("fails loudly when the page layout changes", () => {
    expect(() => parseMlhSeasonPage("<html></html>")).toThrow(/data-page/);
  });

  test("fetch reads the feed URL as HTML", async () => {
    const requested: string[] = [];
    const http = { text: async (url: string, accept?: string) => (requested.push(url + " " + accept), html) };
    const feed = { source: "mlh", name: "MLH 2027 season", url: "https://www.mlh.com/seasons/2027/events" };
    expect(await mlhAdapter.fetch(feed, http)).toEqual(expected);
    expect(requested).toEqual(["https://www.mlh.com/seasons/2027/events text/html"]);
  });
});
