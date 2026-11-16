import type { Adapter } from "../lib/adapter";
import { httpsUrl } from "../lib/media";
import type { RawEvent, RawLocation } from "../lib/rawEvent";
import { toZonedIso } from "../lib/time";

const SOURCE = "jsonld";
const DEFAULT_TIMEZONE = "America/Los_Angeles";

type Node = Record<string, unknown>;

export const jsonldAdapter: Adapter = {
  source: SOURCE,
  async fetch(feed, http) {
    const html = await http.text(feed.url, "text/html");
    return parseEventPage(html, feed.url);
  },
};

export function parseEventPage(html: string, pageUrl: string): RawEvent[] {
  const metas = readMetas(html);
  if (/noindex/i.test(metas.get("robots") ?? "")) return [];

  const nodes = readJsonLd(html).filter(isEventNode);
  if (nodes.length === 0) {
    const fromMeta = eventFromMetas(html, metas, pageUrl);
    return fromMeta ? [fromMeta] : [];
  }

  const events = new Map<string, RawEvent>();
  for (const node of nodes) {
    if (isPrivate(node) || isOnlineOnly(node)) continue;
    const event = eventFromNode(node, pageUrl, metas);
    if (event && !events.has(event.sourceId)) events.set(event.sourceId, event);
  }
  return [...events.values()];
}

export function isOnlineEventPage(html: string): boolean {
  const nodes = readJsonLd(html).filter(isEventNode);
  return nodes.length > 0 && nodes.every(isOnlineOnly);
}

function readJsonLd(html: string): Node[] {
  const nodes: Node[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!isObject(value)) return;
    nodes.push(value);
    if (value["@graph"] !== undefined) visit(value["@graph"]);
  };
  const blocks = html.matchAll(
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const [, body] of blocks) {
    const text = body.trim().replace(/^<!--|-->$/g, "");
    try {
      visit(JSON.parse(text));
    } catch {
      try {
        visit(JSON.parse(text.replace(/[\u0000-\u001f]+/g, " ")));
      } catch {
        continue;
      }
    }
  }
  return nodes;
}

function isEventNode(node: Node): boolean {
  return types(node).some((type) => /Event$/.test(type));
}

function types(node: unknown): string[] {
  if (!isObject(node)) return [];
  return list(node["@type"])
    .filter((type): type is string => typeof type === "string")
    .map((type) => type.replace(/^https?:\/\/schema\.org\//, ""));
}

function isPrivate(node: Node): boolean {
  if (node.isPrivate === true || node.private === true) return true;
  return [node.visibility, node.privacy, node.eventVisibility].some(
    (value) => typeof value === "string" && /private|invite/i.test(value),
  );
}

function isOnlineOnly(node: Node): boolean {
  const mode = text(node.eventAttendanceMode) ?? "";
  if (/OnlineEventAttendanceMode$/.test(mode)) return true;
  const locations = list(node.location);
  if (locations.length === 0) return false;
  return locations.every(
    (location) =>
      types(location).includes("VirtualLocation") ||
      (typeof location === "string" && /^https?:\/\//.test(location)),
  );
}

function eventFromNode(node: Node, pageUrl: string, metas: Map<string, string>): RawEvent | undefined {
  const title = text(node.name);
  const start = text(node.startDate);
  if (!title || !start || Number.isNaN(Date.parse(start))) return undefined;
  const url = absolute(text(node.url), pageUrl) ?? pageUrl;
  const id = absolute(text(node["@id"]), pageUrl);
  const timezone = timezoneFor(start, text(node.scheduleTimezone) ?? text(node.timezone));
  const hosts = organizers(node.organizer);
  return compact({
    source: SOURCE,
    sourceId: id && !id.includes("#") ? id : url,
    title,
    description: text(node.description) ?? metas.get("og:description") ?? metas.get("description") ?? "",
    url,
    ...times(start, text(node.endDate), timezone),
    timezone,
    location: location(node.location),
    organizer: hosts[0],
    hosts: hosts.length > 0 ? hosts : undefined,
    imageUrl: absolute(image(node.image), pageUrl) ?? metas.get("og:image"),
    organizerLogoUrl: organizerLogo(node.organizer, pageUrl),
  });
}

function eventFromMetas(html: string, metas: Map<string, string>, pageUrl: string): RawEvent | undefined {
  const siteName = metas.get("og:site_name");
  let title = metas.get("og:title") ?? metas.get("twitter:title") ?? pageTitle(html);
  if (title && siteName) title = title.replace(new RegExp(`\\s+[|·•–-]\\s+${escapeRegExp(siteName)}$`), "");
  const start =
    metas.get("event:start_time") ??
    metas.get("og:event:start_time") ??
    metas.get("startdate") ??
    timeAttribute(html, /\bdtstart\b|itemprop\s*=\s*["']startDate/i);
  if (!title || !start || Number.isNaN(Date.parse(start))) return undefined;
  const end =
    metas.get("event:end_time") ??
    metas.get("og:event:end_time") ??
    metas.get("enddate") ??
    timeAttribute(html, /\bdtend\b|itemprop\s*=\s*["']endDate/i);
  const url = absolute(metas.get("og:url") ?? canonical(html), pageUrl) ?? pageUrl;
  const place = metas.get("event:location") ?? metas.get("og:event:location");
  const timezone = timezoneFor(start);
  return compact({
    source: SOURCE,
    sourceId: url,
    title: title.trim(),
    description: metas.get("og:description") ?? metas.get("description") ?? "",
    url,
    ...times(start, end, timezone),
    timezone,
    location: place ? { online: false, address: place } : { online: false },
    imageUrl: metas.get("og:image"),
  });
}

function location(value: unknown): RawLocation {
  for (const entry of list(value)) {
    if (typeof entry === "string") {
      if (!/^https?:\/\//.test(entry) && entry.trim()) return { online: false, address: decode(entry.trim()) };
      continue;
    }
    if (!isObject(entry) || types(entry).includes("VirtualLocation")) continue;
    const isAddress = types(entry).includes("PostalAddress");
    const postal = isAddress ? entry : entry.address;
    const geo = isObject(entry.geo) ? entry.geo : entry;
    const lat = number(geo.latitude);
    const lng = number(geo.longitude);
    const hasGeo = lat !== undefined && lng !== undefined;
    return compact({
      online: false,
      name: isAddress ? undefined : text(entry.name),
      address: address(postal),
      city: addressPart(postal, "addressLocality"),
      region: addressPart(postal, "addressRegion"),
      country: addressPart(postal, "addressCountry"),
      lat: hasGeo ? lat : undefined,
      lng: hasGeo ? lng : undefined,
    });
  }
  return { online: false };
}

function addressPart(value: unknown, key: string): string | undefined {
  if (!isObject(value)) return undefined;
  const raw = value[key];
  return text(isObject(raw) ? raw.name : raw);
}

function address(value: unknown): string | undefined {
  if (typeof value === "string") return decode(value.trim()) || undefined;
  if (!isObject(value)) return undefined;
  const parts: string[] = [];
  for (const key of ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"]) {
    const part = addressPart(value, key);
    if (part && !parts.join(", ").toLowerCase().includes(part.toLowerCase())) parts.push(part);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function organizers(value: unknown): string[] {
  const names = list(value).map((entry) => (typeof entry === "string" ? text(entry) : isObject(entry) ? text(entry.name) : undefined));
  return [...new Set(names.filter((name): name is string => name !== undefined))];
}

function organizerLogo(value: unknown, pageUrl: string): string | undefined {
  for (const entry of list(value)) {
    if (!isObject(entry) || !types(entry).some((type) => type === "Organization" || type === "Person")) continue;
    const logo = httpsUrl(absolute(image(entry.logo) ?? image(entry.image), pageUrl));
    if (logo) return logo;
  }
  return undefined;
}

export function ogImage(html: string): string | undefined {
  return readMetas(html).get("og:image");
}

function image(value: unknown): string | undefined {
  for (const entry of list(value)) {
    const url = typeof entry === "string" ? entry : isObject(entry) ? text(entry.url) ?? text(entry.contentUrl) : undefined;
    if (url) return url;
  }
  return undefined;
}

function readMetas(html: string): Map<string, string> {
  const metas = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(tag);
    const content = attrs.get("content");
    if (content === undefined) continue;
    for (const key of [attrs.get("property"), attrs.get("name"), attrs.get("itemprop")]) {
      const name = key?.toLowerCase();
      if (name && !metas.has(name)) metas.set(name, content);
    }
  }
  return metas;
}

function attributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const [, name, dq, sq, bare] of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    attrs.set(name.toLowerCase(), decode(dq ?? sq ?? bare ?? "").trim());
  }
  return attrs;
}

function timeAttribute(html: string, marker: RegExp): string | undefined {
  for (const [tag] of html.matchAll(/<(?:time|meta|span|abbr)\b[^>]*>/gi)) {
    if (!marker.test(tag)) continue;
    const attrs = attributes(tag);
    const value = attrs.get("datetime") ?? attrs.get("content");
    if (value) return value;
  }
  return undefined;
}

function pageTitle(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decode(match[1]).trim() || undefined : undefined;
}

function canonical(html: string): string | undefined {
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(tag);
    if (attrs.get("rel")?.toLowerCase() === "canonical") return attrs.get("href");
  }
  return undefined;
}

function timezoneFor(start: string, explicit?: string): string {
  if (explicit && validZone(explicit)) return explicit;
  const offset = /([+-])(\d{2}):?(\d{2})$/.exec(start);
  if (!offset) return DEFAULT_TIMEZONE;
  const minutes = (offset[1] === "-" ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3]));
  const instant = Date.parse(start);
  if (minutes === 0 || toZonedIso(instant, DEFAULT_TIMEZONE).endsWith(offset[0].replace(/(\d{2})(\d{2})$/, "$1:$2"))) {
    return DEFAULT_TIMEZONE;
  }
  if (minutes % 60 !== 0) return "UTC";
  const hours = -minutes / 60;
  return `Etc/GMT${hours >= 0 ? "+" : ""}${hours}`;
}

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function times(start: string, end: string | undefined, timezone: string): { startsAt: string; endsAt?: string } {
  const endMs = end ? Date.parse(end) : NaN;
  return {
    startsAt: toZonedIso(Date.parse(start), timezone),
    endsAt: Number.isNaN(endMs) ? undefined : toZonedIso(endMs, timezone),
  };
}

function text(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return undefined;
  const result = decode(value).trim();
  return result || undefined;
}

function number(value: unknown): number | undefined {
  const result = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN;
  return Number.isFinite(result) ? result : undefined;
}

function absolute(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
}

function decode(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== "#") return named[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
  });
}

function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isObject(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
