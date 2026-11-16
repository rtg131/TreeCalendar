import { parse, NodeType, type HTMLElement, type Node } from "node-html-parser";
import { toLocalWallTime } from "./time";

export const MAX_TOKENS = 6000;
const CHARS_PER_TOKEN = 4;

const DROP = "script, style, noscript, svg, template, iframe, canvas, nav, footer, form, select, [aria-hidden=true], [hidden]";
const BLOCK = new Set([
  "p", "div", "section", "article", "main", "header", "aside", "li", "ul", "ol", "dl", "dt", "dd", "table", "tr",
  "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "blockquote", "pre", "figure", "figcaption", "address", "time",
]);

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function resolveUrl(href: string, base: string): string | undefined {
  try {
    const url = new URL(href, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function localizeDates(value: unknown, timeZone: string): unknown {
  if (Array.isArray(value)) return value.map((v) => localizeDates(v, timeZone));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => {
      const local = typeof v === "string" && /date$/i.test(k) ? toLocalWallTime(v, timeZone) : undefined;
      return [k, local ? `${local} (${timeZone})` : localizeDates(v, timeZone)];
    }),
  );
}

function eventJsonLd(root: HTMLElement, timeZone: string): string[] {
  const out: string[] = [];
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent);
    } catch {
      continue;
    }
    const queue = Array.isArray(data) ? [...data] : [data];
    while (queue.length) {
      const item = queue.shift() as Record<string, unknown> | null;
      if (!item || typeof item !== "object") continue;
      if (Array.isArray(item["@graph"])) queue.push(...(item["@graph"] as unknown[]));
      const type = [item["@type"]].flat().map(String);
      if (type.some((t) => t.endsWith("Event"))) out.push(JSON.stringify(localizeDates(item, timeZone)));
    }
  }
  return out;
}

function render(node: Node, base: string, timeZone: string, lines: string[], current: string[]): void {
  if (node.nodeType === NodeType.TEXT_NODE) {
    current.push(node.textContent);
    return;
  }
  if (node.nodeType !== NodeType.ELEMENT_NODE) return;
  const el = node as HTMLElement;
  const tag = el.tagName?.toLowerCase() ?? "";
  const block = BLOCK.has(tag);
  const flush = () => {
    const line = current.join("").replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
    current.length = 0;
  };
  if (block) flush();
  if (/^h[1-6]$/.test(tag)) current.push("#".repeat(Number(tag[1])) + " ");
  if (tag === "li") current.push("- ");
  for (const child of el.childNodes) render(child, base, timeZone, lines, current);
  if (tag === "time") {
    const datetime = el.getAttribute("datetime");
    const local = datetime ? toLocalWallTime(datetime, timeZone) : undefined;
    if (datetime) current.push(local ? ` [datetime=${local} ${timeZone}]` : ` [datetime=${datetime}]`);
  }
  if (tag === "a") {
    const href = el.getAttribute("href");
    const url = href ? resolveUrl(href, base) : undefined;
    const text = el.textContent.trim();
    if (url && url !== base && text.length >= 3 && !href!.startsWith("#")) current.push(` <${url}>`);
  }
  if (tag === "td" || tag === "th") current.push(" | ");
  if (block) flush();
}

export function stripPage(html: string, pageUrl: string, timeZone: string, maxTokens = MAX_TOKENS): string {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true, pre: true } });
  const head: string[] = [`URL: ${pageUrl}`];
  const title = root.querySelector("title")?.textContent.trim();
  if (title) head.push(`Page title: ${title}`);
  for (const name of ["description", "og:title", "og:description", "event:start_time", "event:end_time"]) {
    const content = root.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.getAttribute("content")?.trim();
    if (content) head.push(`Meta ${name}: ${content}`);
  }
  const jsonLd = eventJsonLd(root, timeZone).map((s) => `JSON-LD event: ${s.slice(0, 3000)}`).slice(0, 6);

  for (const el of root.querySelectorAll(DROP)) el.remove();
  const body = root.querySelector("body") ?? root;
  const substantial = (el: HTMLElement) => el.textContent.trim().length > 300;
  const mains = body.querySelectorAll("main, [role=main]").filter(substantial);
  const articles = body.querySelectorAll("article").filter(substantial);
  const main = mains[0] ?? (articles.length === 1 ? articles[0] : body);

  const lines: string[] = [];
  render(main, pageUrl, timeZone, lines, []);
  const deduped = lines.filter((line, i) => line !== lines[i - 1]);

  const text = [...head, ...jsonLd, "", "Main text:", ...deduped].join("\n");
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  return text.length > maxChars ? text.slice(0, maxChars) + "\n[truncated]" : text;
}
