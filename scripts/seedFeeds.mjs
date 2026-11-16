#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HANDOFF = join(homedir(), ".capy/drive/project-cac/handoffs/bay-area-feeds.json");
const SAMPLE = "fixtures/feeds/sample.json";
const BATCH = 50;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [path = existsSync(HANDOFF) ? HANDOFF : SAMPLE, ...convexArgs] = args.filter((arg) => arg !== "--dry-run");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') field += text[i++];
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") (row.push(field), (field = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((cell) => cell !== "")) rows.push(row);
      (row = []), (field = "");
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell !== "")) rows.push(row);
  const [header, ...body] = rows;
  return body.map((cells) => Object.fromEntries(header.map((key, i) => [key.trim(), cells[i]?.trim() ?? ""])));
}

function load(file) {
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".csv")) return parseCsv(text);
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : (data.feeds ?? []);
}

function pick(entry) {
  if (entry.feeds_row) return entry.feeds_row;
  if (entry.feed_url !== undefined) {
    return {
      source: entry.feed_source,
      name: entry.feed_name,
      url: entry.feed_url,
      enabled: entry.feed_enabled,
      intervalMinutes: entry.feed_intervalMinutes,
      tier: entry.feed_tier,
    };
  }
  return { ...entry, source: entry.source ?? entry.platform };
}

function toFeed(entry) {
  const row = pick(entry);
  if (!row.source || !row.url) return undefined;
  const interval = Number(row.intervalMinutes);
  const enabled = row.enabled === undefined || row.enabled === "" ? undefined : String(row.enabled).toLowerCase() !== "false";
  return {
    source: String(row.source).toLowerCase(),
    name: String(row.name ?? row.url),
    url: String(row.url),
    ...(Number.isFinite(interval) && interval > 0 ? { intervalMinutes: interval } : {}),
    ...(enabled === undefined ? {} : { enabled }),
    ...(row.tier ? { tier: String(row.tier) } : {}),
  };
}

const LOCALIST_GROUP_ICS = {
  "events.stanford.edu/37955605855836":
    "https://events.stanford.edu/group/asia-pacific_students_entrepreneurial_society/calendar.ics",
  "events.stanford.edu/37955606196886":
    "https://events.stanford.edu/group/business_association_of_stanford_entrepreneurial_students/calendar.ics",
  "calendar.ucsf.edu/9920": "https://calendar.ucsf.edu/group/entrepreneurship_center/calendar.ics",
};

function deploymentHasEnv(name) {
  try {
    const value = execFileSync("npx", ["convex", "env", "get", ...convexArgs, name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return value.trim() !== "";
  } catch {
    return false;
  }
}

let eventbriteTokenSet;
const hasEventbriteToken = () => (eventbriteTokenSet ??= deploymentHasEnv("EVENTBRITE_TOKEN"));

function applyTerms(entry, feed) {
  const platform = entry.source_platform ?? feed.source;
  const host = new URL(feed.url).host;
  if (platform === "luma") {
    if (!entry.ical_url) return { ...feed, enabled: false, why: "luma without a public iCal url" };
    return { ...feed, source: "ical", url: entry.ical_url, tier: "feed", why: "luma moved to its public iCal" };
  }
  if (platform === "mlh") return { ...feed, enabled: false, why: "mlh pending a decision" };
  if (platform === "eventbrite" || host.endsWith("eventbrite.com")) {
    if (!hasEventbriteToken()) {
      return { ...feed, enabled: false, why: "eventbrite stays disabled: EVENTBRITE_TOKEN is not set on the Convex deployment" };
    }
    return { ...feed, source: "eventbrite", enabled: true, why: "eventbrite enabled through the API (EVENTBRITE_TOKEN set)" };
  }
  if (host === "calendar.google.com") return { ...feed, enabled: false, why: "google calendar robots.txt disallows all" };
  if (feed.source === "localist") {
    const groupId = new URL(feed.url).searchParams.get("group_id");
    if (!groupId) return { ...feed, enabled: false, why: "localist filter other than group_id is ignored by the API" };
    const ics = LOCALIST_GROUP_ICS[`${host}/${groupId}`];
    if (!ics) return { ...feed, enabled: false, why: "localist group without a known calendar.ics" };
    return { ...feed, source: "ical", url: ics, tier: "feed", why: "localist group moved to its calendar.ics" };
  }
  return feed;
}

const entries = load(path);
const reasons = {};
const feeds = entries
  .map((entry) => {
    const feed = toFeed(entry);
    if (!feed) return undefined;
    const { why, ...out } = applyTerms(entry, feed);
    if (why) reasons[why] = (reasons[why] ?? 0) + 1;
    return out;
  })
  .filter(Boolean);
console.log(`Seeding ${feeds.length} feeds from ${path} (${entries.length - feeds.length} skipped without source/url)`);
console.log({ enabled: feeds.filter((f) => f.enabled !== false).length, adjusted: reasons });
if (dryRun) {
  console.log(JSON.stringify(feeds, null, 2));
  process.exit(0);
}
const totals = { inserted: 0, updated: 0, unchanged: 0, disabled: 0 };
for (let i = 0; i < feeds.length; i += BATCH) {
  const out = execFileSync(
    "npx",
    [
      "convex",
      "run",
      ...convexArgs,
      "feeds:seed",
      JSON.stringify({ feeds: feeds.slice(i, i + BATCH), ...(i === 0 ? { disableSources: ["luma"] } : {}) }),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const counts = JSON.parse(out);
  for (const key of Object.keys(totals)) totals[key] += counts[key];
}
console.log(totals);
