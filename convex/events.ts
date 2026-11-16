import { v } from "convex/values";
import { query } from "./_generated/server";
import { DEFAULT_DURATION } from "./feed";
import { hostCompany, hostCompanyFor } from "./lib/hostCompany";

export const get = query({
  args: { id: v.id("events") },
  handler: (ctx, { id }) => ctx.db.get(id),
});

export const host = query({
  args: { eventId: v.id("events") },
  returns: v.union(hostCompany, v.null()),
  handler: (ctx, { eventId }) => hostCompanyFor(ctx, eventId),
});

export const search = query({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    if (!q.trim()) return [];
    const now = Date.now();
    const results = await ctx.db
      .query("events")
      .withSearchIndex("search_title", (s) => s.search("title", q))
      .take(40);
    return results.filter((e) => e.hiddenAt === undefined && (e.endTime ?? e.startTime + DEFAULT_DURATION) >= now);
  },
});
