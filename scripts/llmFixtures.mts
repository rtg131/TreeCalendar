import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CompleteFn } from "../convex/adapters/llm/client";

export const FIXTURE_DIR = join(import.meta.dirname, "..", "fixtures", "llm");
export const RECORDED_NOW = new Date("2026-11-15T12:00:00-08:00");

export type PageEntry = { slug: string; url: string };
export type LabelEvent = {
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  url: string;
  description: string | null;
};
export type Label = { url: string; events: LabelEvent[]; maxEvents?: number; notes?: string };
export type RecordedAttempt = ({ content: string } | { error: string }) & { model?: string };
export type Recording = {
  slug: string;
  recordedAt: string;
  now: string;
  status: string;
  attempts: RecordedAttempt[];
};

const readJson = <T,>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

export const listPages = (): PageEntry[] => readJson(join(FIXTURE_DIR, "pages.json"));
export const loadHtml = (slug: string): string => readFileSync(join(FIXTURE_DIR, "pages", `${slug}.html`), "utf8");
export const loadLabel = (slug: string): Label => readJson(join(FIXTURE_DIR, "labels", `${slug}.json`));
export const responsePath = (slug: string): string => join(FIXTURE_DIR, "responses", `${slug}.json`);
export const loadRecording = (slug: string): Recording | undefined =>
  existsSync(responsePath(slug)) ? readJson(responsePath(slug)) : undefined;

export function replayClient(attempts: RecordedAttempt[]): CompleteFn {
  let i = 0;
  return async () => {
    const attempt = attempts[i++];
    if (!attempt) throw new Error("no recorded response left");
    if ("error" in attempt) throw new Error(attempt.error);
    return attempt.content;
  };
}
