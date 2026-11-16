import ICAL from "ical.js";
import type { Adapter } from "../lib/adapter";
import { BAY_AREA_CITIES, foldText } from "../lib/geo";
import type { RawEvent, RawLocation } from "../lib/rawEvent";
import { toZonedIso, zonedToUtc } from "../lib/time";

const HORIZON_DAYS = 60;
const MAX_OCCURRENCES_SCANNED = 50_000;
const DAY_MS = 86_400_000;
const ONLINE_TEXT = /^(online( event| only)?|virtual( event)?|zoom( webinar| meeting| call)?|webinar|google meet|(ms |microsoft )?teams|livestream|remote)$/i;
const PLACEHOLDER_TEXT = /\b(sign in to|log in to|register to see|check (the )?event page|will be (shared|sent|provided)|to be (announced|determined|confirmed))\b|^(tba|tbd|tbc)$/i;
const STREET_ADDRESS = /^(\d+[a-z]?(-\d+)?\s+\S|p\.?\s?o\.? box\b|suite\b|ste\.?\s|unit\s|room\s|floor\s|\d+(st|nd|rd|th) floor\b)/i;
const REGION_OR_POSTCODE = /^([a-z]{2}(\s+\d{5}(-\d{4})?)?|\d{5}(-\d{4})?|usa|us|united states( of america)?|california|canada|united kingdom|uk)$/i;
const CITY_NAMES = new Set(BAY_AREA_CITIES.map((c) => foldText(c.name)));
const ONLINE_MEETING_HOST = /(^|\.)(zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|youtube\.com|youtu\.be|twitch\.tv|discord\.gg|discord\.com)$/i;

const TIMEZONE_ALIASES: Record<string, string> = {
  "Pacific Time (US & Canada)": "America/Los_Angeles",
  "Mountain Time (US & Canada)": "America/Denver",
  "Central Time (US & Canada)": "America/Chicago",
  "Eastern Time (US & Canada)": "America/New_York",
  Arizona: "America/Phoenix",
  Alaska: "America/Anchorage",
  Hawaii: "Pacific/Honolulu",
  "Pacific Standard Time": "America/Los_Angeles",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Central Standard Time": "America/Chicago",
  "Eastern Standard Time": "America/New_York",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "GMT Standard Time": "Europe/London",
  "Coordinated Universal Time": "UTC",
};

export const icalAdapter: Adapter = {
  source: "ical",
  fetch: async (feed, http) =>
    parseIcal(await http.text(feed.url, "text/calendar"), { source: feed.source, feedUrl: feed.url, now: new Date() }),
};

export function parseIcal(ics: string, opts: { source: string; feedUrl: string; now: Date }): RawEvent[] {
  if (!/^\s*BEGIN:VCALENDAR/i.test(ics)) throw new Error("Feed is not an iCalendar document");
  const calendar = new ICAL.Component(ICAL.parse(ics));
  const calendarTz = resolveTimezone(stringValue(calendar.getFirstPropertyValue("x-wr-timezone"))) ?? "UTC";
  const now = opts.now.getTime();
  const horizon = now + HORIZON_DAYS * DAY_MS;

  const exceptionsByUid = new Map<string, ICAL.Component[]>();
  const masters: ICAL.Component[] = [];
  for (const vevent of calendar.getAllSubcomponents("vevent")) {
    const uid = stringValue(vevent.getFirstPropertyValue("uid"));
    if (vevent.hasProperty("recurrence-id") && uid) {
      exceptionsByUid.set(uid, [...(exceptionsByUid.get(uid) ?? []), vevent]);
    } else {
      masters.push(vevent);
    }
  }
  const masterUids = new Set(masters.map((m) => stringValue(m.getFirstPropertyValue("uid"))));
  for (const [uid, exceptions] of exceptionsByUid) {
    if (!masterUids.has(uid)) masters.push(...exceptions);
  }

  const events: RawEvent[] = [];
  for (const master of masters) {
    const event = new ICAL.Event(master);
    const uid = event.uid || undefined;

    if (!event.isRecurring() || event.isRecurrenceException()) {
      const raw = toRawEvent(event, event.startDate, event.endDate, uid, undefined);
      if (raw && Date.parse(raw.endsAt ?? raw.startsAt) >= now) events.push(raw);
      continue;
    }

    for (const exception of exceptionsByUid.get(event.uid) ?? []) event.relateException(exception);
    const masterTzid = tzidOf(master, "dtstart");
    const iterator = event.iterator();
    for (let i = 0; i < MAX_OCCURRENCES_SCANNED; i++) {
      const next = iterator.next();
      if (!next) break;
      const details = event.getOccurrenceDetails(next);
      const recurrenceKey = new Date(toInstant(details.recurrenceId, masterTzid, calendarTz)).toISOString();
      const raw = toRawEvent(details.item, details.startDate, details.endDate, uid, recurrenceKey);
      if (toInstant(next, masterTzid, calendarTz) > horizon && (!raw || Date.parse(raw.startsAt) > horizon)) break;
      if (!raw || Date.parse(raw.startsAt) > horizon || Date.parse(raw.endsAt ?? raw.startsAt) < now) continue;
      events.push(raw);
    }
  }

  return events.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.sourceId.localeCompare(b.sourceId));

  function toRawEvent(
    item: ICAL.Event,
    startDate: ICAL.Time,
    endDate: ICAL.Time,
    uid: string | undefined,
    recurrenceKey: string | undefined,
  ): RawEvent | undefined {
    const component = item.component;
    const visibility = stringValue(component.getFirstPropertyValue("class"))?.toUpperCase();
    if (visibility === "PRIVATE" || visibility === "CONFIDENTIAL") return undefined;
    if (stringValue(component.getFirstPropertyValue("status"))?.toUpperCase() === "CANCELLED") return undefined;
    const title = clean(item.summary);
    if (!title || !startDate) return undefined;

    const startTzid = tzidOf(component, "dtstart");
    const timezone = startDate.isDate || isUtc(startDate) ? calendarTz : resolveTimezone(startTzid) ?? calendarTz;
    const startsAt = toInstant(startDate, startTzid, calendarTz);
    const endsAt = endDate ? toInstant(endDate, tzidOf(component, "dtend") ?? startTzid, calendarTz) : startsAt;

    const rawLocation = clean(item.location);
    const locationIsUrl = rawLocation !== undefined && /^https?:\/\/\S+$/i.test(rawLocation);
    const description = clean(item.description) ?? "";
    const url =
      clean(stringValue(component.getFirstPropertyValue("url"))) ??
      description.match(/https?:\/\/[^\s<>"')\]]+/i)?.[0] ??
      (locationIsUrl ? rawLocation : undefined) ??
      opts.feedUrl;

    return {
      source: opts.source,
      sourceId: recurrenceKey ? `${uid ?? title}#${recurrenceKey}` : uid ?? `${title}#${new Date(startsAt).toISOString()}`,
      title,
      description,
      url,
      startsAt: toZonedIso(startsAt, timezone),
      endsAt: toZonedIso(Math.max(endsAt, startsAt), timezone),
      timezone,
      location: toLocation(rawLocation, locationIsUrl, component.getFirstPropertyValue("geo")),
    };
  }
}

function toLocation(text: string | undefined, isUrl: boolean, geo: unknown): RawLocation {
  if (isUrl && ONLINE_MEETING_HOST.test(new URL(text!).hostname)) return { online: true };
  if (text && ONLINE_TEXT.test(text)) return { online: true };
  const location: RawLocation = { online: false };
  if (text && !isUrl && !PLACEHOLDER_TEXT.test(text)) {
    location.address = text;
    const venue = venueOf(text);
    if (venue) location.name = venue;
  }
  if (Array.isArray(geo) && geo.length === 2 && geo.every((n) => typeof n === "number" && Number.isFinite(n))) {
    location.lat = geo[0];
    location.lng = geo[1];
  }
  return location;
}

export function venueOf(text: string): string | undefined {
  const [first, second] = text.split(/\s*[,\n]\s*/).map((part) => part.trim());
  if (!first || STREET_ADDRESS.test(first) || REGION_OR_POSTCODE.test(first) || CITY_NAMES.has(foldText(first))) return undefined;
  if (second !== undefined && REGION_OR_POSTCODE.test(second)) return undefined;
  return first;
}

function toInstant(time: ICAL.Time, tzid: string | undefined, calendarTz: string): number {
  if (!time.isDate && isUtc(time)) return Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  const tz = (!time.isDate && resolveTimezone(tzid)) || calendarTz;
  return zonedToUtc(time.year, time.month - 1, time.day, time.hour, time.minute, tz) + time.second * 1000;
}

function isUtc(time: ICAL.Time): boolean {
  return time.zone?.tzid === "UTC";
}

function tzidOf(component: ICAL.Component, name: string): string | undefined {
  const value = component.getFirstProperty(name)?.getParameter("tzid");
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

function resolveTimezone(name: string | undefined): string | undefined {
  if (!name) return undefined;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE_ALIASES[name] ?? name }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : value == null ? undefined : String(value);
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\r\n?/g, "\n").trim();
  return trimmed ? trimmed : undefined;
}
