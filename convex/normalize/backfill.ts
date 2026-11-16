import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { eventDoc, mergeInto } from "../lib/store";
import { normalize } from ".";
import { findDuplicate, mergeEvents, pickEvent, sourcesOf } from "./dedupe";
import { cachedGeocoder } from "./geocode";
import { reassignEventRefs } from "./reassignEventRefs";

const DEFAULT_BATCH = 50;

async function renormalized(ctx: MutationCtx, doc: Doc<"events">) {
  const current = pickEvent(doc);
  const listing = doc.rawListingId ? await ctx.db.get(doc.rawListingId) : null;
  const fresh = listing && (await normalize(listing.raw, { geocode: cachedGeocoder(ctx) }));
  if (!fresh || fresh.source !== doc.source || fresh.sourceId !== doc.sourceId) return current;
  return sourcesOf(doc).length > 1 ? mergeEvents(fresh, current) : fresh;
}

export const run = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), batchSize: v.optional(v.number()) },
  returns: v.object({ processed: v.number(), merged: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { cursor = null, batchSize = DEFAULT_BATCH }) => {
    const page = await ctx.db.query("events").paginate({ cursor, numItems: batchSize });
    let processed = 0;
    let merged = 0;
    for (const { _id } of page.page) {
      const doc = await ctx.db.get(_id);
      if (!doc) continue;
      processed++;
      const event = await renormalized(ctx, doc);
      const match = await findDuplicate(ctx, event, doc._id);
      if (!match) {
        await ctx.db.replace(doc._id, { ...eventDoc(event, sourcesOf(doc), doc.rawListingId), hiddenAt: doc.hiddenAt });
        continue;
      }
      const [keep, drop] = match._creationTime <= doc._creationTime ? [match, { ...doc, ...event }] : [{ ...doc, ...event }, match];
      await ctx.db.replace(keep._id, mergeInto(keep, pickEvent(drop), drop.rawListingId, sourcesOf(drop)));
      await reassignEventRefs(ctx, drop._id, keep._id);
      await ctx.db.delete(drop._id);
      merged++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.normalize.backfill.run, { cursor: page.continueCursor, batchSize });
    return { processed, merged, isDone: page.isDone };
  },
});
