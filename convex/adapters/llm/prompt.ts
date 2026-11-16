export const TIMEZONE = "America/Los_Angeles";

export type ModelEvent = {
  title: string;
  startsAt: string;
  endsAt: string | null;
  venue: string | null;
  address: string | null;
  online: boolean;
  url: string | null;
  description: string | null;
  timezone: string | null;
};

const nullableString = { type: ["string", "null"] };

export const EVENTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["events"],
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "startsAt", "endsAt", "timezone", "venue", "address", "online", "url", "description"],
        properties: {
          title: { type: "string" },
          startsAt: { type: "string" },
          endsAt: nullableString,
          timezone: nullableString,
          venue: nullableString,
          address: nullableString,
          online: { type: "boolean" },
          url: nullableString,
          description: nullableString,
        },
      },
    },
  },
} as const;

export const SYSTEM_PROMPT = `You extract events from the text of a web page for an event-discovery app.
Return JSON: {"events": [{"title", "startsAt", "endsAt", "timezone", "venue", "address", "online", "url", "description"}]}.

Rules:
- Include every concrete event the page lists with a date, past or upcoming (talks, meetups, hackathons, pitch nights, demo days, workshops, info sessions). Skip navigation, sponsors, items without any date, and generic program descriptions. If there are no dated events, return {"events": []}.
- Use the page's own wording. Never invent facts that are not on the page.
- title: the event's name as shown, without the organization's site name appended.
- startsAt / endsAt: the event's LOCAL wall-clock time as YYYY-MM-DDTHH:MM with no UTC offset, e.g. 2026-11-20T18:00. Times marked [datetime=... America/Los_Angeles] and JSON-LD dates are already converted to local time; prefer them over prose. If the page gives a date but no time, return the date alone, e.g. 2026-11-20 (never invent 00:00). If the year is missing or the date is relative ("this Friday", "tomorrow"), resolve it against today's date, choosing the nearest sensible year.
- endsAt: only when the page states an end time or end date; for an end time with no date, use the start date. Otherwise null. Never copy startsAt into endsAt.
- timezone: IANA zone of the event if the page says it is outside the default timezone, else null.
- venue: the venue, building, or room name as written on the page, e.g. "Huang Engineering Center, Room 018". null if not stated.
- address: the street address and/or city as written on the page, e.g. "475 Via Ortega, Stanford, CA". null if not stated.
- online: true only for virtual-only events (then venue and address are null).
- url: the event's own detail page if the page links one for that event (links appear as <https://...>). Do not use RSVP, registration, ticket, form, calendar, or livestream links. Otherwise use the page URL.
- description: the first two sentences of the event's own descriptive text, copied verbatim. Not speaker names, links, logistics, or registration notes. null if the page has no description for the event.
- List events in the order they appear on the page. At most 20 events.`;

export function todayIn(now: Date, timeZone = TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function userPrompt(pageText: string, now: Date, timeZone = TIMEZONE): string {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(now);
  return `Today is ${weekday}, ${todayIn(now, timeZone)}. Default timezone: ${timeZone}.\n\n<page>\n${pageText}\n</page>`;
}
