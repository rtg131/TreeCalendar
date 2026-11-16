import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CompleteFn } from "../convex/adapters/llm/client";
import { modelClientFromEnv } from "../convex/adapters/llm/adapter";
import { extractEvents } from "../convex/adapters/llm/extract";
import { RECORDED_NOW, listPages, loadHtml, loadRecording, responsePath, type RecordedAttempt } from "./llmFixtures.mts";

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.filter((a) => !a.startsWith("--"));
const minGapMs = Number(process.env.RECORD_MIN_GAP_MS ?? 8000);

let lastModel = "";
const loggedFetch: typeof fetch = async (input, init) => {
  const started = Date.now();
  const res = await fetch(input, init);
  const host = new URL(String(input)).host;
  lastModel = `${host} ${JSON.parse(String(init?.body)).model}`;
  const retryAfter = res.headers.get("retry-after");
  console.log(`  ${lastModel}: HTTP ${res.status} in ${Date.now() - started}ms${retryAfter ? `, retry-after ${retryAfter}s` : ""}`);
  return res;
};
const live = modelClientFromEnv(loggedFetch);

let calls = 0;
let lastCall = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (const { slug, url } of listPages()) {
  if (only.length && !only.includes(slug)) continue;
  if (!force && loadRecording(slug)) continue;
  const attempts: RecordedAttempt[] = [];
  const recording: CompleteFn = async (messages) => {
    await sleep(Math.max(0, lastCall + minGapMs - Date.now()));
    lastCall = Date.now();
    calls++;
    try {
      const content = await live(messages);
      attempts.push({ content, model: lastModel });
      return content;
    } catch (err) {
      attempts.push({ error: (err as Error).message, model: lastModel });
      throw err;
    }
  };
  const result = await extractEvents({ html: loadHtml(slug), pageUrl: url, now: RECORDED_NOW, complete: recording });
  mkdirSync(dirname(responsePath(slug)), { recursive: true });
  writeFileSync(
    responsePath(slug),
    JSON.stringify({ slug, recordedAt: new Date().toISOString(), now: RECORDED_NOW.toISOString(), status: result.status, attempts }, null, 2) + "\n",
  );
  console.log(`${slug}: ${result.status}, ${result.events.length} events, ${attempts.length} attempt(s)`);
}
console.log(`live model calls: ${calls}`);
