import { v } from "convex/values";
import { query } from "./_generated/server";
import { withHostCompanies } from "./lib/hostCompany";
import { INVESTORS_LIKELY_MIN, rankEvents } from "./lib/ranking";

const DAY = 86_400_000;
export const DEFAULT_DURATION = 3 * 3600_000;

export const feedFilter = v.union(
  v.literal("all"),
  v.literal("investors"),
  v.literal("hackathons"),
  v.literal("pitch"),
  v.literal("networking"),
  v.literal("week"),
);

export const ranked = query({
  args: { deviceId: v.string(), filter: v.optional(feedFilter), radiusKm: v.optional(v.number()) },
  handler: async (ctx, { deviceId, filter = "all", radiusKm }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
      .unique();
    if (!user) return null;
    const now = Date.now();
    const candidates = await ctx.db
      .query("events")
      .withIndex("by_start", (q) => q.gte("startTime", now - 60 * DAY).lte("startTime", now + 90 * DAY))
      .take(800);
    const live = candidates.filter((e) => e.hiddenAt === undefined && (e.endTime ?? e.startTime + DEFAULT_DURATION) >= now);
    const filtered = live.filter((e) => {
      switch (filter) {
        case "investors":
          return e.investorScore >= INVESTORS_LIKELY_MIN;
        case "hackathons":
          return e.eventType === "hackathon";
        case "pitch":
          return e.eventType === "pitch_competition" || e.eventType === "demo_day";
        case "networking":
          return e.eventType === "networking" || e.tags.includes("networking");
        case "week":
          return e.startTime <= now + 7 * DAY;
        default:
          return true;
      }
    });
    const radius = radiusKm ?? user.radiusKm;
    const ranked = rankEvents(filtered, { ...user, now })
      .filter(({ event, distanceKm }) => radius === undefined || event.isOnline || distanceKm === null || distanceKm <= radius)
      .slice(0, 60);
    return {
      city: user.city,
      events: await withHostCompanies(ctx, ranked.map(({ event, score, distanceKm, matched }) => ({
        _id: event._id,
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        city: event.city,
        venue: event.venue,
        lat: event.lat,
        lng: event.lng,
        isOnline: event.isOnline,
        imageUrl: event.imageUrl,
        organizerLogoUrl: event.organizerLogoUrl,
        organizer: event.organizer,
        eventType: event.eventType,
        investorScore: event.investorScore,
        tags: event.tags,
        audience: event.audience,
        source: event.source,
        score,
        distanceKm,
        matched,
      }))),
    };
  },
});
