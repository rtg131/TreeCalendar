import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { parseEventPage } from "./adapters/jsonld";
import { isFeedUrl, normalizeLinkUrl } from "./links";
import { normalize } from "./normalize";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const fixtures = import.meta.glob<string>(["../fixtures/jsonld/*/page.html", "../fixtures/links/*/page.html", "../fixtures/ical/*.ics"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const PARTIFUL = "https://partiful.com/e/LcbSYpufRNRhB4xsh4er";
const LUMA = "https://luma.com/demo-night-dec2026";
const LUMA_ENDED = "https://luma.com/thepitchsf";
const LUMA_ICS = "https://api2.luma.com/ics/get?entity=calendar&id=cal-openrouter";
const deviceId = "device-1";

const pages: Record<string, string> = {
  [PARTIFUL]: fixtures["../fixtures/jsonld/partiful/page.html"],
  [LUMA]: fixtures["../fixtures/jsonld/luma/page.html"],
  [LUMA_ENDED]: fixtures["../fixtures/links/luma-ended/page.html"],
  [LUMA_ICS]: fixtures["../fixtures/ical/luma-openrouter.ics"],
  "https://example.com/about": "<html><head><title>About us</title></head><body>No events here.</body></html>",
};
const redirects: Record<string, string> = {
  "https://short.example.net/evil": "http://127.0.0.1:3210/api/query",
  "https://short.example.net/party": "/go/party",
  "https://short.example.net/go/party": PARTIFUL,
  ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`https://short.example.net/loop/${i}`, `/loop/${i + 1}`])),
};
const robots: Record<string, string> = { "https://blocked.example.org/robots.txt": "User-agent: *\nDisallow: /\n" };

let requests: { url: string; accept: string }[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-11-15T12:00:00-08:00"));
  requests = [];
  vi.stubGlobal("fetch", async (input: string, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    requests.push({ url, accept: init?.headers?.Accept ?? "" });
    if (url.endsWith("/robots.txt")) {
      return robots[url] === undefined ? new Response("", { status: 404 }) : new Response(robots[url]);
    }
    if (url === "https://model.test/v1/chat/completions") {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"events": []}' } }] }));
    }
    if (redirects[url]) return new Response(null, { status: 302, headers: { Location: redirects[url] } });
    const body = pages[url];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(api.users.upsert, {
    deviceId,
    role: "student",
    interests: ["networking", "ai"],
    city: "San Francisco",
    lat: 37.7749,
    lng: -122.4194,
    locationSource: "city",
  });
  return t;
}

describe("links.submit", () => {
  test("a Partiful page and a Luma event link land as events the ranked feed finds", async () => {
    const t = await setup();
    const partiful = await t.action(api.links.submit, { deviceId, url: `${PARTIFUL}?utm_source=share#rsvp` });
    const luma = await t.action(api.links.submit, { deviceId, url: LUMA });
    expect(partiful).toMatchObject({ status: "added" });
    expect(luma).toMatchObject({ status: "added" });
    expect(partiful.eventIds).toHaveLength(1);
    expect(luma.eventIds).toHaveLength(1);

    const feed = await t.query(api.feed.ranked, { deviceId });
    const titles = new Map(feed!.events.map((e) => [e._id, e.title]));
    expect(titles.get(partiful.eventIds[0])).toBe("Date My Friend®: The Millennial Era");
    expect(titles.get(luma.eventIds[0])).toBe("Demo Night @ WorkOS (December)");

    const mine = await t.query(api.links.mine, { deviceId });
    expect(mine.map((s) => [s.url, s.status])).toEqual([
      [LUMA, "added"],
      [PARTIFUL, "added"],
    ]);
    expect(requests.filter((r) => r.url === PARTIFUL)).toEqual([{ url: PARTIFUL, accept: "text/html" }]);
  }, 20_000);

  test("submitting the same event again returns duplicate", async () => {
    const t = await setup();
    const first = await t.action(api.links.submit, { deviceId, url: PARTIFUL });
    const second = await t.action(api.links.submit, { deviceId, url: PARTIFUL });
    expect(first.status).toBe("added");
    expect(second).toEqual({ status: "duplicate", eventIds: first.eventIds });
    expect(await t.run((ctx) => ctx.db.query("events").collect())).toHaveLength(1);
    expect((await t.query(api.links.mine, { deviceId }))[0]).toMatchObject({ status: "duplicate", eventIds: first.eventIds });
  }, 20_000);

  test("an event that has already ended is rejected and not stored", async () => {
    const t = await setup();
    const result = await t.action(api.links.submit, { deviceId, url: LUMA_ENDED });
    expect(result).toEqual({ status: "rejected", eventIds: [], reason: "No upcoming Bay Area events matched this link" });
    expect(await t.run((ctx) => ctx.db.query("events").collect())).toEqual([]);
    expect((await t.query(api.links.mine, { deviceId }))[0]).toMatchObject({ url: LUMA_ENDED, status: "rejected" });
  }, 20_000);

  test("a link for an event already ingested from another source is reported as duplicate", async () => {
    const t = await setup();
    await t.mutation(internal.ingest.ensureFeeds, {});
    const feedId = (await t.run((ctx) => ctx.db.query("feeds").first()))!._id;
    const [lumaRaw] = parseEventPage(pages[LUMA], LUMA);
    const raw = { ...lumaRaw, source: "luma", sourceId: "evt-rGoxcxRUwVLpCGZ" };
    await t.mutation(internal.ingest.store, { feedId, items: [{ raw, event: await normalize(raw) }] });
    const [existing] = await t.run((ctx) => ctx.db.query("events").collect());

    const result = await t.action(api.links.submit, { deviceId, url: LUMA });
    expect(result).toEqual({ status: "duplicate", eventIds: [existing._id] });
    expect(await t.run((ctx) => ctx.db.query("events").collect())).toHaveLength(1);
  }, 20_000);

  test("a Luma calendar ical export goes to the ical adapter", async () => {
    const t = await setup();
    const result = await t.action(api.links.submit, { deviceId, url: LUMA_ICS });
    expect(requests.find((r) => r.url === LUMA_ICS)?.accept).toBe("text/calendar");
    expect(result).toMatchObject({ status: "rejected", reason: "No upcoming Bay Area events matched this link" });
  }, 20_000);

  test("a page with no event data goes through the extraction tier and needs review when the model finds none", async () => {
    vi.stubEnv("MODEL_BASE_URL", "https://model.test/v1");
    vi.stubEnv("MODEL_API_KEY", "test-key");
    const t = await setup();
    const result = await t.action(api.links.submit, { deviceId, url: "https://example.com/about" });
    vi.unstubAllEnvs();
    expect(result).toEqual({ status: "needs_review", eventIds: [], reason: "No event details found on the page" });
    expect(requests.map((r) => r.url)).toContain("https://model.test/v1/chat/completions");
  }, 20_000);

  test("robots.txt disallow rejects the link without fetching the page", async () => {
    const t = await setup();
    const result = await t.action(api.links.submit, { deviceId, url: "https://blocked.example.org/e/1" });
    expect(result.status).toBe("rejected");
    expect(requests.map((r) => r.url)).toEqual(["https://blocked.example.org/robots.txt"]);
  }, 20_000);

  test("a public link that redirects to localhost is rejected before the redirect is fetched", async () => {
    const t = await setup();
    const result = await t.action(api.links.submit, { deviceId, url: "https://short.example.net/evil" });
    expect(result).toEqual({ status: "rejected", eventIds: [], reason: "The link redirects to an address that is not allowed" });
    expect(requests.map((r) => r.url)).toEqual(["https://short.example.net/robots.txt", "https://short.example.net/evil"]);
    expect((await t.query(api.links.mine, { deviceId }))[0]).toMatchObject({ status: "rejected" });
  }, 20_000);

  test("safe redirects are followed with robots checked on each new host", async () => {
    const t = await setup();
    const result = await t.action(api.links.submit, { deviceId, url: "https://short.example.net/party" });
    expect(result.status).toBe("added");
    expect(requests.map((r) => r.url)).toEqual([
      "https://short.example.net/robots.txt",
      "https://short.example.net/party",
      "https://short.example.net/go/party",
      "https://partiful.com/robots.txt",
      PARTIFUL,
    ]);
  }, 20_000);

  test("more than 5 redirects is rejected", async () => {
    const t = await setup();
    const result = await t.action(api.links.submit, { deviceId, url: "https://short.example.net/loop/0" });
    expect(result.status).toBe("rejected");
    expect(requests.filter((r) => r.url.includes("/loop/"))).toHaveLength(6);
  }, 20_000);

  test("private hosts and non-http schemes are rejected and recorded", async () => {
    const t = await setup();
    for (const url of ["http://localhost:3210/x", "http://192.168.1.10/e", "ftp://example.com/e.ics", "file:///etc/passwd"]) {
      expect((await t.action(api.links.submit, { deviceId, url })).status).toBe("rejected");
    }
    expect(requests).toEqual([]);
    const mine = await t.query(api.links.mine, { deviceId });
    expect(mine).toHaveLength(4);
    expect(mine.every((s) => s.status === "rejected" && s.error)).toBe(true);
  });

  test("a device is limited to 10 submissions per hour", async () => {
    const t = await setup();
    for (let i = 0; i < 10; i++) await t.action(api.links.submit, { deviceId, url: `http://localhost/${i}` });
    const limited = await t.action(api.links.submit, { deviceId, url: PARTIFUL });
    expect(limited).toEqual({ status: "rejected", eventIds: [], reason: "Limit of 10 links per hour reached" });
    expect(requests).toEqual([]);
    expect((await t.action(api.links.submit, { deviceId: "device-2", url: "http://localhost/x" })).reason).not.toMatch(/Limit/);
  });
});

describe("link url helpers", () => {
  test("normalizeLinkUrl cleans and validates", () => {
    expect(normalizeLinkUrl(" partiful.com/e/abc?utm_medium=x&id=2#top ")).toEqual({ url: "https://partiful.com/e/abc?id=2" });
    for (const bad of [
      "",
      "javascript:alert(1)",
      "http://127.0.0.1/",
      "http://[::1]/",
      "http://10.0.0.5/",
      "http://intranet/",
      "http://user:pw@example.com/",
      "http://printer.local/",
      "http://169.254.169.254/latest",
    ]) {
      expect(normalizeLinkUrl(bad)).toHaveProperty("error");
    }
  });

  test("isFeedUrl spots .ics files and Luma ical exports", () => {
    expect(isFeedUrl("https://events.stanford.edu/calendar.ics")).toBe(true);
    expect(isFeedUrl(LUMA_ICS)).toBe(true);
    expect(isFeedUrl("https://api.lu.ma/ics/get?entity=calendar&id=cal-1")).toBe(true);
    expect(isFeedUrl(LUMA)).toBe(false);
  });
});
