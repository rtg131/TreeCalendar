import type { Adapter } from "../../lib/adapter";
import { createClient, DEFAULT_MODEL, withFallback, type CompleteFn } from "./client";
import { EVENTS_JSON_SCHEMA } from "./prompt";
import { extractEvents, SOURCE } from "./extract";

declare const process: { env: Record<string, string | undefined> };

export class NeedsReviewError extends Error {
  readonly status = "needs_review";
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(`llmExtract needs review for ${url}: ${reason}`);
  }
}

export function modelClientFromEnv(fetchImpl?: typeof fetch): CompleteFn {
  const env = process.env;
  if (!env.MODEL_BASE_URL || !env.MODEL_API_KEY) throw new Error("MODEL_BASE_URL and MODEL_API_KEY must be set");
  const primary = createClient({
    baseUrl: env.MODEL_BASE_URL,
    apiKey: env.MODEL_API_KEY,
    model: env.MODEL_NAME || DEFAULT_MODEL,
    jsonSchema: EVENTS_JSON_SCHEMA,
    fetchImpl,
  });
  if (!env.MODEL_FALLBACK_BASE_URL || !env.MODEL_FALLBACK_API_KEY) return primary;
  const fallback = createClient({
    baseUrl: env.MODEL_FALLBACK_BASE_URL,
    apiKey: env.MODEL_FALLBACK_API_KEY,
    model: env.MODEL_FALLBACK_NAME || DEFAULT_MODEL,
    jsonSchema: EVENTS_JSON_SCHEMA,
    fetchImpl,
  });
  return withFallback(primary, fallback);
}

export function createLlmExtractAdapter(options: { complete?: CompleteFn; now?: () => Date } = {}): Adapter {
  return {
    source: SOURCE,
    async fetch(feed, http) {
      const html = await http.text(feed.url, "text/html");
      const result = await extractEvents({
        html,
        pageUrl: feed.url,
        now: options.now?.() ?? new Date(),
        complete: options.complete ?? modelClientFromEnv(),
      });
      if (result.status === "needs_review") throw new NeedsReviewError(feed.url, result.reason);
      return result.events;
    },
  };
}

export const llmExtractAdapter = createLlmExtractAdapter();
