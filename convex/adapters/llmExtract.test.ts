import { describe, expect, it } from "vitest";
import { extractEvents, parseModelOutput } from "./llm/extract";
import { stripPage, estimateTokens } from "./llm/strip";
import { TIMEZONE, userPrompt } from "./llm/prompt";
import { toLocalWallTime, withOffset } from "./llm/time";
import { createClient, RateLimitError, withFallback } from "./llm/client";
import { createLlmExtractAdapter, NeedsReviewError } from "./llm/adapter";
import { rawEvent } from "../lib/rawEvent";
import { validateValue } from "./llm/validate";

type Recording = { now: string; status: string; attempts: ({ content: string } | { error: string })[] };
const RECORDED_NOW = new Date("2026-11-15T12:00:00-08:00");
const byName = <T>(files: Record<string, T>) =>
  Object.fromEntries(Object.entries(files).map(([path, value]) => [path.split("/").pop()!.replace(/\.(html|json)$/, ""), value]));
const PAGES = byName(import.meta.glob<string>("../../fixtures/llm/pages/*.html", { query: "?raw", import: "default", eager: true }));
const LABELS = byName(import.meta.glob<{ events: unknown[] }>("../../fixtures/llm/labels/*.json", { import: "default", eager: true }));
const RECORDINGS = byName(import.meta.glob<Recording>("../../fixtures/llm/responses/*.json", { import: "default", eager: true }));
const PAGE_LIST = (await import("../../fixtures/llm/pages.json")).default as { slug: string; url: string }[];

const replayClient = (attempts: Recording["attempts"]) => {
  let i = 0;
  return async () => {
    const attempt = attempts[i++];
    if (!attempt) throw new Error("no recorded response left");
    if ("error" in attempt) throw new Error(attempt.error);
    return attempt.content;
  };
};

const PAGE = "https://example.edu/events/demo-night";
const HTML = `<html><head><title>Demo Night | Club</title><script>var x=1</script></head>
<body><nav>Home About</nav><main><h1>Demo Night</h1><p>Join us for student startup demos.</p>
<p><time datetime="2026-11-21T02:00:00.000Z">Nov 20, 6pm</time> at Huang 018</p>
<a href="/rsvp">RSVP here</a></main><footer>Copyright</footer></body></html>`;
const GOOD = JSON.stringify({
  events: [
    {
      title: "Demo Night",
      startsAt: "2026-11-20T18:00",
      endsAt: "2026-11-20T18:00",
      timezone: null,
      venue: "Huang 018",
      address: null,
      online: false,
      url: "/rsvp",
      description: "Join us for student startup demos.",
    },
  ],
});

describe("stripPage", () => {
  it("keeps main text, links and datetimes and drops chrome", () => {
    const text = stripPage(HTML, PAGE, TIMEZONE);
    expect(text).toContain("# Demo Night");
    expect(text).toContain("[datetime=2026-11-20T18:00 America/Los_Angeles]");
    expect(text).toContain("<https://example.edu/rsvp>");
    expect(text).not.toContain("Copyright");
    expect(text).not.toContain("var x");
  });

  it("caps the page at the token budget", () => {
    const big = `<main>${"<p>word word word word</p>".repeat(20000)}</main>`;
    expect(estimateTokens(stripPage(big, PAGE, TIMEZONE))).toBeLessThanOrEqual(6010);
  });

  it("keeps every fixture page within ~6k tokens", () => {
    for (const { slug, url } of PAGE_LIST) expect(estimateTokens(stripPage(PAGES[slug], url, TIMEZONE))).toBeLessThanOrEqual(6010);
  });
});

describe("time", () => {
  it("converts UTC instants to Los Angeles wall time", () => {
    expect(toLocalWallTime("2026-11-18T01:00:00.000Z", TIMEZONE)).toBe("2026-11-17T17:00");
    expect(toLocalWallTime("2026-11-18", TIMEZONE)).toBeUndefined();
  });

  it("adds the right Pacific offset on each side of DST", () => {
    expect(withOffset("2026-02-16T18:00", TIMEZONE)).toBe("2026-02-16T18:00:00-08:00");
    expect(withOffset("2026-07-16T18:00", TIMEZONE)).toBe("2026-07-16T18:00:00-07:00");
    expect(withOffset("2026-11-20", TIMEZONE)).toBe("2026-11-20");
    expect(withOffset("2026-11-20T18:00:00-05:00", TIMEZONE)).toBe("2026-11-20T18:00:00-05:00");
  });
});

describe("prompt", () => {
  it("passes today's date and the Los Angeles timezone", () => {
    const prompt = userPrompt("x", RECORDED_NOW);
    expect(prompt).toContain("Sunday, 2026-11-15");
    expect(prompt).toContain("America/Los_Angeles");
  });
});

describe("extractEvents", () => {
  it("returns validated RawEvents with absolute urls", async () => {
    const result = await extractEvents({ html: HTML, pageUrl: PAGE, now: RECORDED_NOW, complete: async () => GOOD });
    expect(result.status).toBe("ok");
    expect(result.events[0]).toMatchObject({
      title: "Demo Night",
      startsAt: "2026-11-20T18:00:00-08:00",
      url: "https://example.edu/rsvp",
      source: "llmExtract",
      timezone: "America/Los_Angeles",
      location: { online: false, name: "Huang 018" },
    });
    expect(result.events[0]).not.toHaveProperty("endsAt");
    expect(validateValue(rawEvent, result.events[0])).toEqual([]);
  });

  it("retries once with the validation error, then succeeds", async () => {
    const seen: number[] = [];
    const answers = ["not json", GOOD];
    const result = await extractEvents({
      html: HTML,
      pageUrl: PAGE,
      now: RECORDED_NOW,
      complete: async (messages) => {
        seen.push(messages.length);
        return answers.shift()!;
      },
    });
    expect(result).toMatchObject({ status: "ok", attempts: 2 });
    expect(seen).toEqual([2, 4]);
  });

  it("returns needs_review after two invalid answers", async () => {
    const bad = JSON.stringify({ events: [{ title: "x", startsAt: "next friday" }] });
    const result = await extractEvents({ html: HTML, pageUrl: PAGE, now: RECORDED_NOW, complete: async () => bad });
    expect(result).toMatchObject({ status: "needs_review", events: [], attempts: 2 });
    if (result.status === "needs_review") expect(result.reason).toContain("not ISO 8601");
  });

  it("returns needs_review when the model call keeps failing", async () => {
    const result = await extractEvents({
      html: HTML,
      pageUrl: PAGE,
      now: RECORDED_NOW,
      complete: async () => {
        throw new Error("HTTP 500");
      },
    });
    expect(result).toMatchObject({ status: "needs_review", reason: "HTTP 500" });
  });

  it("rejects a response without an events array and skips non-object items", () => {
    expect(parseModelOutput("{}", PAGE)).toHaveProperty("errors");
    const parsed = parseModelOutput(JSON.stringify({ events: ["", { title: "A", startsAt: "2026-12-01", timezone: "Mars/Base" }] }), PAGE);
    expect(parsed).toEqual({ events: [expect.objectContaining({ title: "A", startsAt: "2026-12-01", url: PAGE })] });
  });
});

describe("llmExtract adapter", () => {
  const FEED = { source: "llmExtract", name: "Demo club", url: PAGE };
  const fixtureHttp = (body: string) => {
    const calls: [string, string | undefined][] = [];
    return { calls, http: { text: async (url: string, accept?: string) => (calls.push([url, accept]), body) } };
  };

  it("downloads the page through the injected http and returns RawEvents", async () => {
    const { calls, http } = fixtureHttp(HTML);
    const adapter = createLlmExtractAdapter({ complete: async () => GOOD, now: () => RECORDED_NOW });
    const events = await adapter.fetch(FEED, http);
    expect(calls).toEqual([[PAGE, "text/html"]]);
    expect(events).toHaveLength(1);
  });

  it("throws NeedsReviewError when extraction fails twice", async () => {
    const { http } = fixtureHttp(HTML);
    const adapter = createLlmExtractAdapter({ complete: async () => "nope", now: () => RECORDED_NOW });
    await expect(adapter.fetch(FEED, http)).rejects.toBeInstanceOf(NeedsReviewError);
  });
});

describe("createClient", () => {
  it("sends JSON-mode requests and backs off on 429", async () => {
    const bodies: Record<string, unknown>[] = [];
    const sleeps: number[] = [];
    const responses = [
      new Response("rate limited", { status: 429, headers: { "retry-after": "3" } }),
      new Response(JSON.stringify({ choices: [{ message: { content: GOOD } }] }), { status: 200 }),
    ];
    const complete = createClient({
      baseUrl: "https://host/v1/",
      apiKey: "k",
      model: "m",
      sleep: async (ms) => void sleeps.push(ms),
      fetchImpl: (async (url: string, init: RequestInit) => {
        expect(url).toBe("https://host/v1/chat/completions");
        bodies.push(JSON.parse(init.body as string));
        return responses.shift()!;
      }) as unknown as typeof fetch,
    });
    expect(await complete([{ role: "user", content: "json" }])).toBe(GOOD);
    expect(sleeps).toEqual([3000]);
    expect(bodies[0]).toMatchObject({ model: "m", response_format: { type: "json_object" } });
  });
});

describe("model fallback", () => {
  const limited = (retryAfter: string) =>
    createClient({
      baseUrl: "https://primary/v1",
      apiKey: "k",
      sleep: async () => {},
      fetchImpl: (async () => new Response("", { status: 429, headers: { "retry-after": retryAfter } })) as unknown as typeof fetch,
    });

  it("gives up at once on a long retry-after instead of waiting", async () => {
    await expect(limited("871")([{ role: "user", content: "json" }])).rejects.toBeInstanceOf(RateLimitError);
  });

  it("uses the fallback host only when the primary is rate limited", async () => {
    const fallback = async () => GOOD;
    expect(await withFallback(limited("871"), fallback)([])).toBe(GOOD);
    const broken = async () => {
      throw new Error("HTTP 500");
    };
    await expect(withFallback(broken, fallback)([])).rejects.toThrow("HTTP 500");
  });
});

describe("recorded fixtures", () => {
  it("has 30 pages, each with saved HTML, a label and a recorded response", () => {
    expect(PAGE_LIST).toHaveLength(30);
    for (const { slug } of PAGE_LIST) {
      expect(PAGES[slug]).toBeTypeOf("string");
      expect(LABELS[slug].events).toBeInstanceOf(Array);
      expect(RECORDINGS[slug].attempts.length).toBeGreaterThan(0);
    }
  });

  it.each(PAGE_LIST.map((p) => [p.slug, p.url]))("replays %s offline into valid RawEvents", async (slug, url) => {
    const recording = RECORDINGS[slug];
    const result = await extractEvents({ html: PAGES[slug], pageUrl: url, now: new Date(recording.now), complete: replayClient(recording.attempts) });
    expect(result.status).toBe(recording.status);
    for (const event of result.events) expect(validateValue(rawEvent, event)).toEqual([]);
  });
});
