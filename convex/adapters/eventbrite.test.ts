import { afterEach, describe, expect, test, vi } from "vitest";
import ascentExpected from "../../fixtures/eventbrite/ascent-valley-78282849753.expected.json";
import ascentPage1 from "../../fixtures/eventbrite/ascent-valley-78282849753.p1.json";
import ascentPage2 from "../../fixtures/eventbrite/ascent-valley-78282849753.p2.json";
import foundersExpected from "../../fixtures/eventbrite/founders-village-32506722299.expected.json";
import foundersPage from "../../fixtures/eventbrite/founders-village-32506722299.json";
import hackerDojoPage from "../../fixtures/eventbrite/hacker-dojo-13396913509.json";
import techSfExpected from "../../fixtures/eventbrite/tech-sf-65252219403.expected.json";
import techSfPage from "../../fixtures/eventbrite/tech-sf-65252219403.json";
import { resolveAdapter } from ".";
import {
  MissingEventbriteTokenError,
  eventbriteAdapter,
  organizerEventsUrl,
  organizerId,
  parseEventbritePage,
  type EventbritePage,
} from "./eventbrite";

const feed = (url: string) => ({ source: "eventbrite", name: "Organizer", url });

function fixtureHttp(pages: Record<string, unknown>) {
  const calls: { url: string; accept?: string; headers?: Record<string, string> }[] = [];
  const http = {
    text: async (url: string, accept?: string, headers?: Record<string, string>) => {
      calls.push({ url, accept, headers });
      if (!(url in pages)) throw new Error(`unexpected request ${url}`);
      return JSON.stringify(pages[url]);
    },
  };
  return { calls, http };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("eventbrite adapter", () => {
  test("maps recorded organizer pages to RawEvent", () => {
    expect(parseEventbritePage(foundersPage as EventbritePage)).toEqual(foundersExpected);
    expect(parseEventbritePage(techSfPage as EventbritePage)).toEqual(techSfExpected);
    expect(parseEventbritePage(hackerDojoPage as EventbritePage)).toEqual([]);
  });

  test("keeps the published timezone, venue and coordinates", () => {
    const [event] = parseEventbritePage(techSfPage as EventbritePage);
    expect(event.timezone).toBe("America/Los_Angeles");
    expect(event.startsAt).toBe("2027-01-28T18:00:00-08:00");
    expect(event.location).toMatchObject({ online: false, name: "Toy Soldier", city: "San Francisco", lat: 37.7914322 });
  });

  test("skips online-only, unlisted, invite-only and non-live events", () => {
    const [base] = (techSfPage as EventbritePage).events!;
    const page: EventbritePage = {
      events: [
        { ...base, id: "online", online_event: true },
        { ...base, id: "unlisted", listed: false },
        { ...base, id: "invite", invite_only: true },
        { ...base, id: "draft", status: "draft" },
        { ...base, id: "kept" },
      ],
    };
    expect(parseEventbritePage(page).map((e) => e.sourceId)).toEqual(["kept"]);
  });

  test("reads the organizer id from the feed URL", () => {
    expect(organizerId("https://www.eventbrite.com/o/ascent-valley-78282849753")).toBe("78282849753");
    expect(organizerId("https://www.eventbrite.com/o/65252219403")).toBe("65252219403");
    expect(() => organizerId("https://www.eventbrite.com/e/some-event-123")).toThrow(/organizer URL/);
  });

  test("follows pagination and sends the token as a header", async () => {
    vi.stubEnv("EVENTBRITE_TOKEN", "test-token");
    const page1 = organizerEventsUrl("78282849753");
    const page2 = organizerEventsUrl("78282849753", ascentPage1.pagination.continuation);
    const { calls, http } = fixtureHttp({ [page1]: ascentPage1, [page2]: ascentPage2 });
    const events = await eventbriteAdapter.fetch(feed("https://www.eventbrite.com/o/ascent-valley-78282849753"), http);
    expect(events).toEqual(ascentExpected);
    expect(calls.map((c) => c.url)).toEqual([page1, page2]);
    expect(page1).toBe("https://www.eventbriteapi.com/v3/organizers/78282849753/events/?status=live&expand=venue%2Corganizer%2Corganizer.logo");
    for (const call of calls) {
      expect(call.accept).toBe("application/json");
      expect(call.headers).toEqual({ Authorization: "Bearer test-token" });
      expect(call.url).not.toContain("test-token");
    }
  });

  test("refuses to run without EVENTBRITE_TOKEN", async () => {
    vi.stubEnv("EVENTBRITE_TOKEN", "");
    const { calls, http } = fixtureHttp({});
    await expect(eventbriteAdapter.fetch(feed("https://www.eventbrite.com/o/65252219403"), http)).rejects.toBeInstanceOf(
      MissingEventbriteTokenError,
    );
    expect(calls).toEqual([]);
  });

  test("is registered ahead of the JSON-LD tier for eventbrite feeds", () => {
    expect(resolveAdapter({ source: "eventbrite", tier: "JSON-LD" })).toBe(eventbriteAdapter);
  });
});
