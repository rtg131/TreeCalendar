import type { NormalizedEvent } from ".";

export type Embedder = { embed(events: NormalizedEvent[]): Promise<void> };

export const embedText = (e: NormalizedEvent) => [e.title, e.tags.join(" "), e.description].join("\n");

/**
 * Embedding seam for normalize. Without EMBED_API_KEY it returns null and ingest skips the step.
 * A provider (and an events.embedding field with a vector index) plugs in here once a key exists.
 */
export function embedderFromEnv(env: Record<string, string | undefined> = process.env): Embedder | null {
  if (!env.EMBED_API_KEY) return null;
  return {
    async embed(events) {
      console.warn(`EMBED_API_KEY is set but no embedding provider is wired; skipped ${events.length} events`);
    },
  };
}
