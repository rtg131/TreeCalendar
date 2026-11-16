import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery, type ActionCtx } from "../_generated/server";
import type { Http } from "./adapter";
import { ROBOTS_USER_AGENT, isAllowed } from "./robots";

export const USER_AGENT = `${ROBOTS_USER_AGENT}/0.1 (+https://github.com/waddlethegreat1/cac)`;
export const DOMAIN_INTERVAL_MS = 1000;
export const DOMAIN_SHARDS = 4;
export const RESERVE_ATTEMPTS = 6;
export const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
export const ROBOTS_ERROR_TTL_MS = 10 * 60 * 1000;
const DISALLOW_ALL = "User-agent: *\nDisallow: /\n";

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt disallows ${url}`);
    this.name = "RobotsDisallowedError";
  }
}

export const getRobots = internalQuery({
  args: { domain: v.string() },
  handler: async (ctx, { domain }) =>
    ctx.db
      .query("robots_cache")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .unique(),
});

export const putRobots = internalMutation({
  args: { domain: v.string(), body: v.string(), ttlMs: v.number() },
  handler: async (ctx, { domain, body, ttlMs }) => {
    const now = Date.now();
    const row = { domain, body, fetchedAt: now, expiresAt: now + ttlMs };
    const existing = await ctx.db
      .query("robots_cache")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .unique();
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("robots_cache", row);
  },
});

export const slotKey = (domain: string, shard: number) => `${domain}#${shard}`;

export function phaseAligned(earliest: number, shard: number): number {
  const cycle = DOMAIN_INTERVAL_MS * DOMAIN_SHARDS;
  const phase = shard * DOMAIN_INTERVAL_MS;
  return earliest + ((((phase - earliest) % cycle) + cycle) % cycle);
}

export const reserveSlot = internalMutation({
  args: { domain: v.string(), shard: v.number() },
  returns: v.number(),
  handler: async (ctx, { domain, shard }) => {
    const key = slotKey(domain, shard);
    const existing = await ctx.db
      .query("domain_rate")
      .withIndex("by_domain", (q) => q.eq("domain", key))
      .unique();
    const at = phaseAligned(Math.max(Date.now(), existing?.nextAllowedAt ?? 0), shard);
    const nextAllowedAt = at + DOMAIN_INTERVAL_MS * DOMAIN_SHARDS;
    if (existing) await ctx.db.patch(existing._id, { nextAllowedAt });
    else await ctx.db.insert("domain_rate", { domain: key, nextAllowedAt });
    return at;
  },
});

const lastShard = new Map<string, { shard: number; at: number }>();

function takeShard(domain: string): number {
  const now = Date.now();
  const last = lastShard.get(domain);
  const shard =
    last && now - last.at < DOMAIN_INTERVAL_MS * DOMAIN_SHARDS
      ? (last.shard + 1) % DOMAIN_SHARDS
      : Math.ceil(now / DOMAIN_INTERVAL_MS) % DOMAIN_SHARDS;
  lastShard.set(domain, { shard, at: now });
  return shard;
}

const isWriteConflict = (err: unknown) =>
  /changed while this mutation was being run|OptimisticConcurrencyControlFailure|write conflict/i.test(err instanceof Error ? err.message : String(err));

export async function reserve(ctx: Pick<ActionCtx, "runMutation">, domain: string): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ctx.runMutation(internal.lib.http.reserveSlot, { domain, shard: takeShard(domain) });
    } catch (err) {
      if (attempt >= RESERVE_ATTEMPTS || !isWriteConflict(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt + Math.random() * 200));
    }
  }
}

export async function throttledFetch(
  ctx: Pick<ActionCtx, "runMutation">,
  url: string,
  accept: string,
  redirect: RequestRedirect = "follow",
  headers: Record<string, string> = {},
) {
  const at = await reserve(ctx, new URL(url).host);
  const wait = at - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return fetch(url, { headers: { ...headers, "User-Agent": USER_AGENT, Accept: accept }, redirect });
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export const MAX_REDIRECTS = 5;

export type HttpOptions = {
  validateUrl?: (url: string) => string | undefined;
};

export function makeHttp(ctx: ActionCtx, { validateUrl }: HttpOptions = {}): Http {
  const guardedFetch = async (
    url: string,
    accept: string,
    beforeHop?: (url: string) => Promise<void>,
    headers?: Record<string, string>,
  ) => {
    if (!validateUrl) return throttledFetch(ctx, url, accept, "follow", headers);
    let current = url;
    for (let hop = 0; ; hop++) {
      const sameOrigin = new URL(current).origin === new URL(url).origin;
      const res = await throttledFetch(ctx, current, accept, "manual", sameOrigin ? headers : undefined);
      if (res.status < 300 || res.status >= 400) return res;
      const location = res.headers.get("location");
      if (!location) return res;
      if (hop >= MAX_REDIRECTS) throw new UnsafeUrlError(`${url} redirected more than ${MAX_REDIRECTS} times`);
      const next = new URL(location, current).toString();
      const problem = validateUrl(next);
      if (problem) throw new UnsafeUrlError(`${current} redirected to a blocked address: ${problem}`);
      await beforeHop?.(next);
      current = next;
    }
  };

  const robotsFor = async (url: string) => {
    const { host, origin } = new URL(url);
    const cached = await ctx.runQuery(internal.lib.http.getRobots, { domain: host });
    if (cached && cached.expiresAt > Date.now()) return cached.body;
    let body: string;
    let ttlMs = ROBOTS_TTL_MS;
    try {
      const res = await guardedFetch(`${origin}/robots.txt`, "text/plain");
      if (res.ok) body = await res.text();
      else if (res.status >= 400 && res.status < 500) body = "";
      else {
        body = DISALLOW_ALL;
        ttlMs = ROBOTS_ERROR_TTL_MS;
      }
    } catch {
      body = DISALLOW_ALL;
      ttlMs = ROBOTS_ERROR_TTL_MS;
    }
    await ctx.runMutation(internal.lib.http.putRobots, { domain: host, body, ttlMs });
    return body;
  };

  return {
    async text(url, accept = "*/*", headers) {
      const problem = validateUrl?.(url);
      if (problem) throw new UnsafeUrlError(`${url} is a blocked address: ${problem}`);
      const checkRobots = async (target: string) => {
        if (!isAllowed(await robotsFor(target), target)) throw new RobotsDisallowedError(target);
      };
      await checkRobots(url);
      const res = await guardedFetch(url, accept, checkRobots, headers);
      if (!res.ok) throw new Error(`${url} responded ${res.status}`);
      return res.text();
    },
  };
}
