export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type CompleteFn = (messages: ChatMessage[]) => Promise<string>;

export const DEFAULT_MODEL = "openai/gpt-oss-20b";

export class RateLimitError extends Error {}

export type ClientOptions = {
  baseUrl: string;
  apiKey: string;
  model?: string;
  jsonSchema?: Record<string, unknown>;
  reasoningEffort?: "low" | "medium" | "high";
  maxCompletionTokens?: number;
  maxRetries429?: number;
  maxRetryWaitMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
};

export function createClient(options: ClientOptions): CompleteFn {
  const { baseUrl, apiKey, model = DEFAULT_MODEL, jsonSchema, reasoningEffort = "low", maxCompletionTokens = 4000, maxRetries429 = 4, maxRetryWaitMs = 60_000, timeoutMs = 90_000 } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fetchImpl = options.fetchImpl ?? fetch;
  const responseFormat = jsonSchema
    ? { type: "json_schema", json_schema: { name: "events", schema: jsonSchema, strict: false } }
    : { type: "json_object" };

  return async (messages) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          reasoning_effort: reasoningEffort,
          max_completion_tokens: maxCompletionTokens,
          response_format: responseFormat,
        }),
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt;
        if (attempt >= maxRetries429 || waitMs > maxRetryWaitMs) {
          throw new RateLimitError(`model rate limited: HTTP 429, retry after ${Math.round(waitMs / 1000)}s`);
        }
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) throw new Error(`model request failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
      const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
      if (body.usage) console.log(`llm usage model=${model} prompt=${body.usage.prompt_tokens ?? 0} completion=${body.usage.completion_tokens ?? 0} total=${body.usage.total_tokens ?? 0}`);
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("model returned no content");
      return content;
    }
  };
}

export function withFallback(primary: CompleteFn, fallback: CompleteFn): CompleteFn {
  return async (messages) => {
    try {
      return await primary(messages);
    } catch (err) {
      if (!(err instanceof RateLimitError)) throw err;
      return fallback(messages);
    }
  };
}
