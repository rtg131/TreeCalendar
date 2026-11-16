import { rawEvent, type RawEvent, type RawLocation } from "../../lib/rawEvent";
import { validateValue } from "./validate";
import { stripPage } from "./strip";
import { SYSTEM_PROMPT, TIMEZONE, userPrompt } from "./prompt";
import type { ChatMessage, CompleteFn } from "./client";
import { withOffset } from "./time";

export const SOURCE = "llmExtract";

export type ExtractResult =
  | { status: "ok"; events: RawEvent[]; attempts: number }
  | { status: "needs_review"; events: []; attempts: number; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function isIsoTime(value: string): boolean {
  return (ISO_DATE.test(value) || ISO_DATETIME.test(value)) && !Number.isNaN(Date.parse(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function dropUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function validZone(zone: string | undefined): string | undefined {
  if (!zone) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

function absoluteUrl(value: unknown, pageUrl: string): string {
  const raw = optionalString(value);
  if (!raw) return pageUrl;
  try {
    return new URL(raw, pageUrl).toString();
  } catch {
    return pageUrl;
  }
}

export function parseModelOutput(
  content: string,
  pageUrl: string,
  timeZone = TIMEZONE,
): { events: RawEvent[] } | { errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch (err) {
    return { errors: [`response is not valid JSON: ${(err as Error).message}`] };
  }
  const list = (data as { events?: unknown })?.events;
  if (!Array.isArray(list)) return { errors: ['response must be an object with an "events" array'] };

  const errors: string[] = [];
  const events: RawEvent[] = [];
  list.forEach((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const e = item as Record<string, unknown>;
    const url = absoluteUrl(e.url, pageUrl);
    const zone = validZone(optionalString(e.timezone)) ?? timeZone;
    const toIso = (value: unknown) => {
      const s = optionalString(value);
      return s && withOffset(s, zone);
    };
    const startsAt = toIso(e.startsAt);
    const endsAt = toIso(e.endsAt);
    const online = e.online === true;
    const location: RawLocation = online
      ? { online: true }
      : { online: false, name: optionalString(e.venue), address: optionalString(e.address) };
    const candidate = {
      source: SOURCE,
      sourceId: `${url}#${startsAt ?? i}`,
      title: optionalString(e.title),
      description: optionalString(e.description) ?? "",
      url,
      startsAt,
      endsAt: !endsAt || endsAt === startsAt || endsAt === startsAt?.slice(0, 10) ? undefined : endsAt,
      timezone: zone,
      location: dropUndefined(location),
    };
    const issues = validateValue(rawEvent, candidate, `events[${i}]`);
    if (candidate.startsAt && !isIsoTime(candidate.startsAt)) issues.push(`events[${i}].startsAt: not ISO 8601 (${candidate.startsAt})`);
    if (candidate.endsAt && !isIsoTime(candidate.endsAt)) issues.push(`events[${i}].endsAt: not ISO 8601 (${candidate.endsAt})`);
    if (issues.length) errors.push(...issues);
    else events.push(dropUndefined(candidate) as RawEvent);
  });
  return errors.length ? { errors } : { events };
}

export async function extractEvents(args: {
  html: string;
  pageUrl: string;
  now: Date;
  complete: CompleteFn;
  timeZone?: string;
}): Promise<ExtractResult> {
  const { html, pageUrl, now, complete, timeZone = TIMEZONE } = args;
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt(stripPage(html, pageUrl, timeZone), now, timeZone) },
  ];

  let reason = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    let content: string;
    try {
      content = await complete(messages);
    } catch (err) {
      reason = (err as Error).message;
      continue;
    }
    const parsed = parseModelOutput(content, pageUrl, timeZone);
    if ("events" in parsed) return { status: "ok", events: parsed.events, attempts: attempt };
    reason = parsed.errors.slice(0, 10).join("; ");
    messages.push(
      { role: "assistant", content },
      { role: "user", content: `That JSON was invalid: ${reason}. Return the corrected JSON only.` },
    );
  }
  return { status: "needs_review", events: [], attempts: 2, reason };
}
