import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { fingerprint, templateFollowup } from "./prepContent";

export async function deletePrepReferences(ctx: MutationCtx, eventId: Id<"events">): Promise<void> {
  const briefing = await ctx.db.query("prep_briefings").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique();
  if (briefing) await ctx.db.delete(briefing._id);
  const followups = await ctx.db.query("prep_followups").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect();
  for (const row of followups) await ctx.db.delete(row._id);
}

export async function rekeyPrepReferences(ctx: MutationCtx, dropEventId: Id<"events">, keepEventId: Id<"events">): Promise<void> {
  if (dropEventId === keepEventId) return;
  const survivor = await ctx.db.get(keepEventId);
  if (!survivor) throw new Error("Prep survivor event not found");
  const currentFingerprint = fingerprint(survivor);
  for (const eventId of [dropEventId, keepEventId]) {
    const briefing = await ctx.db.query("prep_briefings").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique();
    if (briefing) await ctx.db.delete(briefing._id);
  }
  const kept = await ctx.db.query("prep_followups").withIndex("by_event", (q) => q.eq("eventId", keepEventId)).collect();
  for (const row of kept) await ctx.db.patch(row._id, { fingerprint: currentFingerprint, value: templateFollowup(survivor, row.value.recipient) });
  const dropped = await ctx.db.query("prep_followups").withIndex("by_event", (q) => q.eq("eventId", dropEventId)).collect();
  for (const row of dropped) {
    const collision = await ctx.db.query("prep_followups").withIndex("by_user_event", (q) => q.eq("userId", row.userId).eq("eventId", keepEventId)).unique();
    if (collision) await ctx.db.delete(row._id);
    else await ctx.db.patch(row._id, { eventId: keepEventId, fingerprint: currentFingerprint, value: templateFollowup(survivor, row.value.recipient) });
  }
}
