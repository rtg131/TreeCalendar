#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const jsonOut = args.find((a) => a.startsWith("--json="))?.slice(7);
const convexArgs = args.filter((a) => !a.startsWith("--json="));
const out = execFileSync("npx", ["convex", "run", ...convexArgs, "qa:report", "{}"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
  maxBuffer: 64 * 1024 * 1024,
});
const r = JSON.parse(out);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(r, null, 2));

const table = (rows, cols) =>
  [`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.map((c) => String(c ?? "").replace(/\|/g, "\\|")).join(" | ")} |`)].join("\n");
const counts = (obj) => table(Object.entries(obj).sort((a, b) => b[1] - a[1]), ["key", "events"]);

const t = r.totals;
const lines = [
  `# Event QA (${new Date(r.now).toISOString()})`,
  "",
  "## Totals",
  table(
    [
      ["events (excluding seed/fixture and hidden)", t.events],
      ["hidden (no longer listed by any source)", t.hidden],
      ["upcoming", t.upcoming],
      ["upcoming, Bay Area in person", t.bayAreaInPerson],
      ["upcoming, online", t.online],
      ["upcoming, no location", t.noLocation],
    ],
    ["metric", "count"],
  ),
  "",
  "## Upcoming by source",
  counts(r.bySource),
  "",
  "## Upcoming by tier",
  counts(r.byTier),
  "",
  "## Upcoming by city",
  counts(r.byCity),
  "",
  "## Missing fields (upcoming)",
  table(Object.entries(r.missing), ["field", "events"]),
  "",
  "## Duplicates",
  `Unmerged pairs with title similarity >= 0.85 within 2h in the same city: ${r.duplicates.flaggedPairs}. Excess events: ${r.duplicates.eventsInExcess} of ${t.upcoming} (${r.duplicates.rate}%).`,
  "",
  table(r.duplicates.pairs.map((p) => [p.similarity, p.minutesApart, p.city, p.a, p.aSource, p.b, p.bSource]), ["sim", "min apart", "city", "a", "a source", "b", "b source"]),
  "",
  "### Near-threshold pairs (0.70 to 0.85), not merged",
  table(r.duplicates.loose.map((p) => [p.similarity, p.minutesApart, p.city, p.a, p.b]), ["sim", "min apart", "city", "a", "b"]),
  "",
  `## Merged rows: ${r.merges.rows}`,
  table(r.merges.sample.map((m) => [m.title, m.city, m.sources.join("<br>")]), ["title", "city", "sources"]),
  "",
  "## Feed yield (enabled feeds, latest fetch)",
  table(
    [...r.feeds].sort((a, b) => (a.status === b.status ? b.insertedCount - a.insertedCount : a.status.localeCompare(b.status))).map((f) => [f.status, f.rawCount, f.insertedCount, f.source, f.tier, f.name, f.error ?? ""]),
    ["status", "raw", "kept", "source", "tier", "feed", "error"],
  ),
  "",
  `Zero-yield feeds: ${r.feeds.filter((f) => f.status === "ok" && f.insertedCount === 0).length}. Errors: ${r.feeds.filter((f) => f.status !== "ok").length}.`,
];
console.log(lines.join("\n"));
