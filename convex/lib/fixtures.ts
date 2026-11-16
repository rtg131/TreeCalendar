import { toZonedIso, zonedToUtc } from "./time";

export const SCOUT_TEST_EVENT_PATH = "/fixtures/scout-test-event";
export const SCOUT_TEST_EVENT_ID = "cac-scout-test-event";
export const SCOUT_TEST_EVENT_TITLE = "[TEST] Scout fixture hack night";
export const PAST_TEST_EVENT_ID = "cac-scout-test-past-event";
export const PAST_TEST_EVENT_TITLE = "[TEST] Scout fixture past hack night";

const TIMEZONE = "America/Los_Angeles";
const DAY = 86_400_000;
const HOUR = 3_600_000;

export function isFixtureUrl(url: string): boolean {
  try {
    return new URL(url).pathname === SCOUT_TEST_EVENT_PATH;
  } catch {
    return false;
  }
}

export function scoutTestEventTimes(now: number): { start: number; end: number } {
  const [year, month, day] = toZonedIso(now + 7 * DAY, TIMEZONE).slice(0, 10).split("-").map(Number);
  const start = zonedToUtc(year, month - 1, day, 18, 0, TIMEZONE);
  return { start, end: start + 2 * HOUR };
}

export function scoutTestEventHtml(canonicalUrl: string, now: number): string {
  const { start, end } = scoutTestEventTimes(now);
  const description =
    "Synthetic test data for CAC end-to-end tests, not a real event. Students build side projects together at an evening hack night.";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    "@id": canonicalUrl,
    identifier: SCOUT_TEST_EVENT_ID,
    name: SCOUT_TEST_EVENT_TITLE,
    url: canonicalUrl,
    description,
    startDate: toZonedIso(start, TIMEZONE),
    endDate: toZonedIso(end, TIMEZONE),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: "CAC Test Venue",
      address: {
        "@type": "PostalAddress",
        streetAddress: "1 Market St",
        addressLocality: "San Francisco",
        addressRegion: "CA",
        postalCode: "94105",
        addressCountry: "US",
      },
      geo: { "@type": "GeoCoordinates", latitude: 37.7941, longitude: -122.3951 },
    },
    organizer: { "@type": "Organization", name: "CAC test fixtures" },
  };
  const script = JSON.stringify(jsonLd).replace(/</g, "\\u003c");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${SCOUT_TEST_EVENT_TITLE}</title>`,
    `<link rel="canonical" href="${canonicalUrl}">`,
    `<script type="application/ld+json">${script}</script>`,
    "</head>",
    `<body><h1>${SCOUT_TEST_EVENT_TITLE}</h1><p>${description}</p></body>`,
    "</html>",
  ].join("\n");
}
