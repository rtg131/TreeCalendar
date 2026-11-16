import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { ensureUser, recordFor, recordsFor, MAX_COMMITMENTS, saveResponse } from "./attendanceModel";

export const run = internalMutation({
  args: { deviceId: v.optional(v.string()) },
  returns: v.object({ eventIds: v.array(v.id("events")), pendingEventId: v.union(v.id("events"), v.null()), historyEventId: v.union(v.id("events"), v.null()) }),
  handler: async (ctx, { deviceId }) => {
    const now = Date.now();
    const eventIds = [];
    for (const [index, name] of ["Student Pitch Night", "AI Builder Meetup", "Founder Demo Day"].entries()) {
      const sourceId = `attendance-demo-${index + 1}`;
      const existing = await ctx.db.query("events").withIndex("by_source_sourceId", (q) => q.eq("source", "attendance-demo").eq("sourceId", sourceId)).unique();
      const eventId = existing?._id ?? await ctx.db.insert("events", {
        title: `[DEMO] ${name}`, description: "Fictional demo event with synthetic attendance and ratings. Not a real listing.",
        startTime: now - (index + 2) * 86_400_000, endTime: now - (index + 2) * 86_400_000 + 7_200_000,
        timezone: "America/Los_Angeles", city: "San Francisco", lat: 37.7749, lng: -122.4194,
        venue: "Demo venue (fictional)", isOnline: false, url: `https://example.com/${sourceId}`,
        source: "attendance-demo", sourceId, hosts: [], tags: ["demo"], eventType: "networking",
        audience: ["students", "founders"], investorScore: 0, investorSignals: [], lastSeenAt: now,
      });
      eventIds.push(eventId);
      for (let i = 0; i < 3; i++) {
        const userId = await ensureUser(ctx, `attendance-demo-reviewer-${i + 1}`);
        if (await recordFor(ctx, userId, eventId)) continue;
        const id = await ctx.db.insert("attendance", { userId, eventId, going: true });
        const record = (await ctx.db.get(id))!;
        await saveResponse(ctx, record, { attended: true, rating: [10, 8, 6][i], investors: i === 0 ? "yes" : i === 1 ? "no" : "unsure", note: "Demo feedback (synthetic)." });
      }
    }
    if (deviceId !== undefined) {
      const userId = await ensureUser(ctx, deviceId);
      for (const [index, eventId] of eventIds.slice(0, 2).entries()) {
        if (await recordFor(ctx, userId, eventId)) continue;
        if ((await recordsFor(ctx, userId)).length >= MAX_COMMITMENTS) throw new Error("Attendance limit exceeded");
        const id = await ctx.db.insert("attendance", { userId, eventId, going: true });
        if (index === 1) await saveResponse(ctx, (await ctx.db.get(id))!, {
          attended: true, rating: 8, investors: "unsure", note: "Demo: useful conversations with other builders.",
        });
      }
    }
    return { eventIds, pendingEventId: deviceId === undefined ? null : eventIds[0], historyEventId: deviceId === undefined ? null : eventIds[1] };
  },
});
