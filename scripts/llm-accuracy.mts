import { extractEvents } from "../convex/adapters/llm/extract";
import type { RawEvent } from "../convex/lib/rawEvent";
import { listPages, loadHtml, loadLabel, loadRecording, replayClient, type LabelEvent } from "./llmFixtures.mts";

export const FIELDS = ["title", "startsAt", "endsAt", "location", "url", "description"] as const;
type Field = (typeof FIELDS)[number];

const tokens = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

function recall(expected: string, actual: string): number {
  const want = tokens(expected);
  const have = new Set(tokens(actual));
  return want.length ? want.filter((t) => have.has(t)).length / want.length : 1;
}

function titleScore(a: string, b: string): number {
  return Math.min(recall(a, b), recall(b, a));
}

function sameTime(expected: string | null, actual: string | undefined): boolean {
  if (!expected || !actual) return !expected && !actual;
  const dateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (dateOnly(expected) || dateOnly(actual)) return expected === actual;
  return Date.parse(expected) === Date.parse(actual);
}

function normalizeUrl(s: string): string {
  try {
    const u = new URL(s);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
    return (u.host.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "") + u.search).toLowerCase();
  } catch {
    return s;
  }
}

export function locationText(event: RawEvent): string | undefined {
  if (event.location.online) return "Online";
  return [event.location.name, event.location.address].filter(Boolean).join(", ") || undefined;
}

export function fieldCorrect(field: Field, expected: LabelEvent, actual: RawEvent): boolean {
  switch (field) {
    case "title":
      return titleScore(expected.title, actual.title) >= 0.8;
    case "startsAt":
      return sameTime(expected.startsAt, actual.startsAt);
    case "endsAt":
      return sameTime(expected.endsAt, actual.endsAt);
    case "url":
      return normalizeUrl(expected.url) === normalizeUrl(actual.url);
    case "location":
    case "description": {
      const want = expected[field];
      const got = field === "location" ? locationText(actual) : actual.description || undefined;
      if (!want || !got) return !want && !got;
      if (field === "description" && tokens(got).length >= 6 && recall(got, want) >= 0.9) return true;
      return recall(want, got) >= 0.6;
    }
  }
}

function matchEvents(labels: LabelEvent[], extracted: RawEvent[]): [LabelEvent, RawEvent | undefined][] {
  const free = new Set(extracted.map((_, i) => i));
  return labels.map((label) => {
    let best = -1;
    let bestScore = 0.5;
    for (const i of free) {
      const score = titleScore(label.title, extracted[i].title) + (sameTime(label.startsAt, extracted[i].startsAt) ? 0.5 : 0);
      if (score > bestScore) [best, bestScore] = [i, score];
    }
    if (best < 0) return [label, undefined];
    free.delete(best);
    return [label, extracted[best]];
  });
}

export async function scoreAll() {
  const correct = Object.fromEntries(FIELDS.map((f) => [f, 0])) as Record<Field, number>;
  let labeled = 0;
  let matched = 0;
  let extra = 0;
  let emptyPagesCorrect = 0;
  let emptyPages = 0;
  const statuses: Record<string, number> = {};
  const pages: { slug: string; status: string; labeled: number; matched: number; extra: number; wrong: string[] }[] = [];

  for (const { slug, url } of listPages()) {
    const label = loadLabel(slug);
    const recording = loadRecording(slug);
    const result = recording
      ? await extractEvents({ html: loadHtml(slug), pageUrl: url, now: new Date(recording.now), complete: replayClient(recording.attempts) })
      : { status: "missing", events: [] as RawEvent[] };
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    const pairs = matchEvents(label.events, result.events);
    const wrong: string[] = [];
    for (const [expected, actual] of pairs) {
      labeled++;
      if (!actual) {
        wrong.push(`missing "${expected.title}"`);
        continue;
      }
      matched++;
      for (const f of FIELDS) {
        if (fieldCorrect(f, expected, actual)) correct[f]++;
        else wrong.push(`${f}: want ${JSON.stringify(expected[f])} got ${JSON.stringify((f === "location" ? locationText(actual) : actual[f]) ?? null)}`);
      }
    }
    const pageExtra = label.maxEvents ? 0 : result.events.length - pairs.filter(([, a]) => a).length;
    extra += pageExtra;
    if (label.events.length === 0) {
      emptyPages++;
      if (result.events.length === 0) emptyPagesCorrect++;
    }
    pages.push({ slug, status: result.status, labeled: label.events.length, matched: pairs.filter(([, a]) => a).length, extra: pageExtra, wrong });
  }

  const total = labeled * FIELDS.length;
  const overall = Object.values(correct).reduce((a, b) => a + b, 0);
  return {
    pages,
    statuses,
    labeled,
    matched,
    extra,
    emptyPages,
    emptyPagesCorrect,
    perField: Object.fromEntries(FIELDS.map((f) => [f, labeled ? correct[f] / labeled : 0])) as Record<Field, number>,
    overall: total ? overall / total : 0,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await scoreAll();
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  if (process.argv.includes("--verbose")) {
    for (const p of report.pages) {
      console.log(`${p.slug} [${p.status}] matched ${p.matched}/${p.labeled}, extra ${p.extra}`);
      for (const w of p.wrong) console.log(`    ${w}`);
    }
    console.log("");
  }
  console.log(`pages: ${report.pages.length}  statuses: ${JSON.stringify(report.statuses)}`);
  console.log(`labeled events: ${report.labeled}  matched: ${report.matched}  extra (unlabeled) events: ${report.extra}`);
  console.log(`no-event pages correctly empty: ${report.emptyPagesCorrect}/${report.emptyPages}`);
  for (const f of FIELDS) console.log(`  ${f.padEnd(12)} ${pct(report.perField[f])}`);
  console.log(`overall field accuracy: ${pct(report.overall)}`);
}
