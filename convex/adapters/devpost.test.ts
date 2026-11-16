import { describe, expect, test } from "vitest";
import emptyPage from "../../fixtures/devpost/empty-page.json";
import inPersonExpected from "../../fixtures/devpost/in-person-page-1.expected.json";
import inPersonPage from "../../fixtures/devpost/in-person-page-1.json";
import page2 from "../../fixtures/devpost/in-person-page-2.json";
import page3 from "../../fixtures/devpost/in-person-page-3.json";
import adapterExpected from "../../fixtures/devpost/in-person.expected.json";
import onlineExpected from "../../fixtures/devpost/online-page-1.expected.json";
import onlinePage from "../../fixtures/devpost/online-page-1.json";
import { devpostAdapter, enrichFromHackathonPage, parseDevpostDates, parseDevpostLocation, parseDevpostPage } from "./devpost";

const hackathonPages = import.meta.glob("../../fixtures/devpost/pages/*.html", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const pageById = (id: number | string) => hackathonPages["../../fixtures/devpost/pages/" + id + ".html"];

const inPersonFeed = {
  source: "devpost",
  name: "Devpost in-person hackathons",
  url: "https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&challenge_type[]=in-person",
};
const listPages = [inPersonPage, page2, page3];

function fixtureHttp(pages: object[], options: { hackathonPages?: boolean } = {}) {
  const requested: string[] = [];
  const byUrl = new Map<string, string>();
  for (const page of pages) {
    for (const h of (page as typeof inPersonPage).hackathons) {
      const html = pageById(h.id);
      if (html && options.hackathonPages !== false) byUrl.set(h.url, html);
    }
  }
  return {
    requested,
    text: async (url: string) => {
      requested.push(url);
      if (url.startsWith("https://devpost.com/api/")) {
        const page = Number(new URL(url).searchParams.get("page"));
        return JSON.stringify(pages[page - 1] ?? emptyPage);
      }
      const html = byUrl.get(url);
      if (!html) throw new Error("no fixture for " + url);
      return html;
    },
  };
}

describe("devpost adapter", () => {
  test("parses saved in-person and online pages into RawEvents", () => {
    expect(parseDevpostPage(inPersonPage)).toEqual(inPersonExpected);
    expect(parseDevpostPage(onlinePage)).toEqual(onlineExpected);
  });

  test("listing-only parse keeps the venue and Pacific dates", () => {
    const immerse = parseDevpostPage(inPersonPage).find((e) => e.title.startsWith("Immerse the Bay"));
    expect(immerse?.location).toEqual({ online: false, name: "Stanford University" });
    expect(immerse?.startsAt).toMatch(/T09:00:00-0[78]:00$/);
    expect(immerse?.timezone).toBe("America/Los_Angeles");
  });

  test("marks Online, virtual and globe listings as online and '+ Online' venues as hybrid", () => {
    const byTitle = new Map(parseDevpostPage(inPersonPage).map((e) => [e.title, e]));
    expect(byTitle.get("Teens Hack Houston Hackathon")?.location).toEqual({ online: true });
    expect(byTitle.get("ESE1110 Fall 2026")?.location).toEqual({ online: true });
    expect(parseDevpostPage(onlinePage).every((e) => e.location.online)).toBe(true);
    const devweek = parseDevpostPage(page3).find((e) => e.title === "DeveloperWeek 2027 Hackathon");
    expect(devweek?.description).toMatch(/^Hybrid hackathon/);
    expect(devweek?.location.online).toBe(false);
  });

  test("parses every Devpost date range format", () => {
    expect(parseDevpostDates("Oct 30 - Dec 04, 2026")).toEqual({
      start: { year: 2026, month: 9, day: 30 },
      end: { year: 2026, month: 11, day: 4 },
    });
    expect(parseDevpostDates("Nov 14 - 15, 2026")?.end).toEqual({ year: 2026, month: 10, day: 15 });
    expect(parseDevpostDates("Dec 28 - Jan 04, 2027")?.start.year).toBe(2026);
    expect(parseDevpostDates("Dec 15, 2026 - Jan 10, 2027")?.end.year).toBe(2027);
    expect(parseDevpostDates("Nov 15, 2026")?.start).toEqual({ year: 2026, month: 10, day: 15 });
    expect(parseDevpostDates("Rolling")).toBeUndefined();
  });

  test.each([
    ["Seattle, Washington, USA", { city: "Seattle", region: "Washington", country: "US" }],
    ["Edmonton, Canada", { city: "Edmonton", country: "CA" }],
    ["Pleasanton, CA", { city: "Pleasanton", region: "CA", country: "US" }],
    ["Ginsburg Hall, USC", {}],
    ["Stanford University", {}],
  ])("reads a city from listing text %s only when it names one", (text, expected) => {
    const { name, ...rest } = parseDevpostLocation(text);
    expect(name).toBe(text);
    expect(JSON.parse(JSON.stringify(rest))).toEqual(expected);
  });

  test("fetch keeps only in-person and hybrid hackathons, with exact times and city from each hackathon page", async () => {
    const http = fixtureHttp(listPages);
    const events = await devpostAdapter.fetch(inPersonFeed, http);
    expect(events).toEqual(adapterExpected);
    expect(events.some((e) => e.location.online)).toBe(false);
    for (const e of events) {
      expect(e.location.city).toBeTruthy();
      expect(e.location.country).toBeTruthy();
      expect(Date.parse(e.endsAt!)).toBeGreaterThan(Date.parse(e.startsAt));
    }
    const sunhacks = events.find((e) => e.title === "sunhacks 2026");
    expect(sunhacks).toMatchObject({
      startsAt: "2026-11-14T14:00:00-05:00",
      endsAt: "2026-11-15T13:30:00-05:00",
      timezone: "America/New_York",
      location: { online: false, city: "Tempe", region: "Arizona", country: "US" },
    });
  });

  test("fetch pages through the feed URL until a page comes back empty", async () => {
    const http = fixtureHttp(listPages);
    await devpostAdapter.fetch(inPersonFeed, http);
    const apiCalls = http.requested.filter((url) => url.startsWith("https://devpost.com/api/"));
    expect(apiCalls.map((url) => new URL(url).searchParams.get("page"))).toEqual(["1", "2", "3", "4"]);
  });

  test("fetch falls back to listing dates and location text when a hackathon page fails", async () => {
    const events = await devpostAdapter.fetch(inPersonFeed, fixtureHttp([page3], { hackathonPages: false }));
    expect(events.find((e) => e.title === "Haven Seattle")).toMatchObject({
      startsAt: "2026-11-14T09:00:00-08:00",
      timezone: "America/Los_Angeles",
      location: { online: false, city: "Seattle", region: "Washington", country: "US" },
    });
  });

  test("an online feed keeps online hackathons and skips hackathon pages", async () => {
    const http = fixtureHttp([onlinePage]);
    const events = await devpostAdapter.fetch({ ...inPersonFeed, url: "https://devpost.com/api/hackathons?challenge_type[]=online" }, http);
    expect(events).toEqual(onlineExpected);
    expect(http.requested.every((url) => url.startsWith("https://devpost.com/api/"))).toBe(true);
  });

  test("a page whose JSON-LD says online turns the event online", () => {
    const [event] = parseDevpostPage(page3);
    const html = '<script type="application/ld+json">{"@type":"Event","eventAttendanceMode":"https://schema.org/OnlineEventAttendanceMode"}</script>';
    expect(enrichFromHackathonPage(event, html).location).toEqual({ online: true });
  });
});
