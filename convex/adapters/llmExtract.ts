"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { rawEvent } from "../lib/rawEvent";
import { modelClientFromEnv } from "./llm/adapter";
import { extractEvents } from "./llm/extract";

export const extract = internalAction({
  args: { url: v.string(), html: v.string() },
  returns: v.union(
    v.object({ status: v.literal("ok"), events: v.array(rawEvent), attempts: v.number() }),
    v.object({ status: v.literal("needs_review"), events: v.array(rawEvent), attempts: v.number(), reason: v.string() }),
  ),
  handler: async (_ctx, { url, html }) => {
    return await extractEvents({ html, pageUrl: url, now: new Date(), complete: modelClientFromEnv() });
  },
});
