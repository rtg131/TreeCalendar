import { describe, expect, it } from "vitest";
import { jsonldAdapter, parseEventPage } from "./jsonld";

const files = import.meta.glob<string>("../../fixtures/jsonld/*/*.{html,json}", { query: "?raw", import: "default", eager: true });
const sites = [...new Set(Object.keys(files).map((path) => path.split("/").at(-2)!))].sort();
const fixture = (site: string, name: string) => files[`../../fixtures/jsonld/${site}/${name}`];

function stubHttp(pages: Record<string, string>) {
  return {
    async text(url: string) {
      const page = pages[url];
      if (page === undefined) throw new Error(`no fixture for ${url}`);
      return page;
    },
  };
}

describe("jsonld fixtures", () => {
  it("covers the four sites plus the meta fallback", () => {
    expect(sites).toEqual(["eventbrite", "luma", "meetup", "partiful", "partiful-meta"]);
  });

  for (const site of sites) {
    it(site, async () => {
      const { url } = JSON.parse(fixture(site, "source.json")) as { url: string };
      const http = stubHttp({ [url]: fixture(site, "page.html") });
      const events = await jsonldAdapter.fetch({ source: "jsonld", name: site, url }, http);
      expect(events).toEqual(JSON.parse(fixture(site, "expected.json")));
    });
  }
});

function page(...blocks: unknown[]) {
  const scripts = blocks.map((block) => `<script type="application/ld+json">${JSON.stringify(block)}</script>`);
  return `<html><head>${scripts.join("")}</head></html>`;
}

const base = {
  "@type": "Event",
  name: "Hack Night",
  startDate: "2026-12-01T18:00:00-08:00",
  location: { "@type": "Place", name: "Noisebridge", address: "272 Capp St, San Francisco, CA" },
};

describe("jsonld parsing", () => {
  it("reads events from @graph and arrays and skips non-events", () => {
    const html = page(
      { "@context": "https://schema.org", "@graph": [{ "@type": "WebPage", name: "x" }, { ...base, url: "/e/1" }] },
      [{ ...base, name: "Second", url: "/e/2" }],
    );
    const events = parseEventPage(html, "https://example.com/page");
    expect(events.map((event) => [event.title, event.sourceId])).toEqual([
      ["Hack Night", "https://example.com/e/1"],
      ["Second", "https://example.com/e/2"],
    ]);
  });

  it("skips online-only events but keeps mixed ones", () => {
    const html = page(
      { ...base, url: "/online", eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode" },
      { ...base, url: "/virtual", location: { "@type": "VirtualLocation", url: "https://zoom.us/j/1" } },
      {
        ...base,
        url: "/mixed",
        eventAttendanceMode: "https://schema.org/MixedEventAttendanceMode",
        location: [{ "@type": "VirtualLocation", url: "https://zoom.us/j/1" }, base.location],
      },
    );
    const events = parseEventPage(html, "https://example.com/");
    expect(events.map((event) => event.url)).toEqual(["https://example.com/mixed"]);
    expect(events[0].location).toEqual({ online: false, name: "Noisebridge", address: "272 Capp St, San Francisco, CA" });
  });

  it("skips events marked private and pages marked noindex", () => {
    expect(parseEventPage(page({ ...base, isPrivate: true }), "https://example.com/")).toEqual([]);
    expect(parseEventPage(page({ ...base, visibility: "Private" }), "https://example.com/")).toEqual([]);
    const noindex = page(base).replace("<head>", '<head><meta name="robots" content="noindex, nofollow">');
    expect(parseEventPage(noindex, "https://example.com/")).toEqual([]);
  });

  it("maps organizers, postal address, geo and image objects", () => {
    const html = page({
      ...base,
      location: {
        "@type": "Place",
        name: "Venue",
        address: { "@type": "PostalAddress", streetAddress: "1 Main St", addressLocality: "Oakland", addressRegion: "CA" },
        geo: { "@type": "GeoCoordinates", latitude: "37.8", longitude: "-122.27" },
      },
      organizer: [{ "@type": "Organization", name: "Bay Hackers" }, { "@type": "Person", name: "Someone" }],
      image: { "@type": "ImageObject", url: "/cover.png" },
    });
    expect(parseEventPage(html, "https://example.com/e")).toEqual([
      {
        source: "jsonld",
        sourceId: "https://example.com/e",
        title: "Hack Night",
        description: "",
        url: "https://example.com/e",
        startsAt: "2026-12-01T18:00:00-08:00",
        timezone: "America/Los_Angeles",
        location: {
          online: false,
          name: "Venue",
          address: "1 Main St, Oakland, CA",
          city: "Oakland",
          region: "CA",
          lat: 37.8,
          lng: -122.27,
        },
        organizer: "Bay Hackers",
        hosts: ["Bay Hackers", "Someone"],
        imageUrl: "https://example.com/cover.png",
      },
    ]);
  });

  it("converts UTC times to the event timezone and keeps an explicit zone", () => {
    const utc = parseEventPage(page({ ...base, startDate: "2026-07-01T01:00:00.000Z" }), "https://example.com/");
    expect([utc[0].startsAt, utc[0].timezone]).toEqual(["2026-06-30T18:00:00-07:00", "America/Los_Angeles"]);
    const ny = parseEventPage(page({ ...base, startDate: "2026-12-01T18:00:00-05:00" }), "https://example.com/");
    expect([ny[0].startsAt, ny[0].timezone]).toEqual(["2026-12-01T18:00:00-05:00", "Etc/GMT+5"]);
    const named = parseEventPage(
      page({ ...base, startDate: "2026-12-01T18:00:00-05:00", scheduleTimezone: "America/New_York" }),
      "https://example.com/",
    );
    expect([named[0].startsAt, named[0].timezone]).toEqual(["2026-12-01T18:00:00-05:00", "America/New_York"]);
  });

  it("returns nothing from metadata without a start time", () => {
    const html = '<html><head><meta property="og:title" content="Party"></head></html>';
    expect(parseEventPage(html, "https://example.com/")).toEqual([]);
  });
});
