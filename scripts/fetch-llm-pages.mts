import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

type Page = { slug: string; url: string };
type Rules = { allow: string[]; disallow: string[] };

const UA = "cac-event-bot/0.1 (hackathon research; contact via github.com/waddlethegreat1/cac)";
const UA_TOKEN = "cac-event-bot";
const TIMEOUT_MS = 20_000;
const MIN_GAP_MS = 1_000;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pagesFile = join(root, "fixtures/llm/pages.json");
const outDir = join(root, "fixtures/llm/pages");

const lastRequestAt = new Map<string, number>();
const robotsCache = new Map<string, Rules>();
let requestCount = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function politeFetch(url: string): Promise<Response> {
  const host = new URL(url).host;
  const wait = (lastRequestAt.get(host) ?? 0) + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
  requestCount++;
  return fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    credentials: "omit",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function parseRobots(text: string): Rules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: (typeof groups)[number] | undefined;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.allow.push(value);
    if (key === "disallow" && value) current.disallow.push(value);
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && UA_TOKEN.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  return {
    allow: chosen.flatMap((g) => g.allow),
    disallow: chosen.flatMap((g) => g.disallow),
  };
}

function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const pattern = body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp("^" + pattern + (anchored ? "$" : "")).test(path);
}

function isAllowed(rules: Rules, path: string): boolean {
  let best: { len: number; allow: boolean } | undefined;
  for (const [list, allow] of [[rules.allow, true], [rules.disallow, false]] as const) {
    for (const rule of list) {
      if (!ruleMatches(rule, path)) continue;
      const len = rule.length;
      if (!best || len > best.len || (len === best.len && allow)) best = { len, allow };
    }
  }
  return best ? best.allow : true;
}

async function robotsFor(url: string): Promise<Rules> {
  const origin = new URL(url).origin;
  const cached = robotsCache.get(origin);
  if (cached) return cached;
  let rules: Rules = { allow: [], disallow: [] };
  try {
    const res = await politeFetch(origin + "/robots.txt");
    if (res.ok) rules = parseRobots(await res.text());
    else if (res.status === 401 || res.status === 403) rules = { allow: [], disallow: ["/"] };
    else await res.body?.cancel();
  } catch (err) {
    console.log(`robots.txt unreachable for ${origin} (${(err as Error).message}); treating as allow-all`);
  }
  robotsCache.set(origin, rules);
  return rules;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const pages: Page[] = JSON.parse(await readFile(pagesFile, "utf8"));
await mkdir(outDir, { recursive: true });
const only = new Set(process.argv.slice(2));
let saved = 0;
let skipped = 0;

for (const { slug, url } of pages) {
  if (only.size && !only.has(slug)) continue;
  const htmlPath = join(outDir, slug + ".html");
  if (await exists(htmlPath)) continue;
  const target = new URL(url);
  const rules = await robotsFor(url);
  if (!isAllowed(rules, target.pathname + target.search)) {
    console.log(`SKIP robots: ${slug} ${url}`);
    skipped++;
    continue;
  }
  try {
    const res = await politeFetch(url);
    const type = res.headers.get("content-type") ?? "";
    if (res.status !== 200 || !type.includes("text/html")) {
      console.log(`SKIP ${res.status} ${type}: ${slug} ${url}`);
      await res.body?.cancel();
      skipped++;
      continue;
    }
    const html = await res.text();
    await writeFile(htmlPath, html);
    await writeFile(
      join(outDir, slug + ".meta.json"),
      JSON.stringify({ url, finalUrl: res.url, fetchedAt: new Date().toISOString() }, null, 2) + "\n",
    );
    console.log(`saved ${slug} (${html.length} chars)`);
    saved++;
  } catch (err) {
    console.log(`SKIP error: ${slug} ${url} (${(err as Error).message})`);
    skipped++;
  }
}

console.log(`done: ${saved} saved, ${skipped} skipped, ${requestCount} HTTP requests`);
