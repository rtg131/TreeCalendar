import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { action, query } from "./_generated/server";
import { briefingValue, cleanRecipient, followupValue, QUESTIONS, templateBriefing, templateFollowup } from "./prepContent";
import type { Briefing, Followup } from "./prepContent";
import { load, prepArgs } from "./prepStore";
import type { PrepareArgs, Prepared, StoreArgs } from "./prepStore";

const prepare = makeFunctionReference<"mutation", PrepareArgs, Prepared>("prepStore:prepare");
const store = makeFunctionReference<"mutation", StoreArgs, null>("prepStore:store");

async function selectTemplates(fallback: Briefing, description: string): Promise<Briefing> {
  const key = process.env.PREP_API_KEY;
  if (!key) return fallback;
  try {
    const response = await fetch(`${(process.env.PREP_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        model: process.env.PREP_MODEL || "gpt-4o-mini",
        temperature: 0,
        max_tokens: 120,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `Select 2 or 3 distinct question indexes. Return only JSON {"questions":[0,1,2]}. Never write prose or names. Questions: ${JSON.stringify(QUESTIONS)}.` },
          { role: "user", content: JSON.stringify({ listing: fallback.summary, description }) },
        ],
      }),
    });
    if (!response.ok) return fallback;
    const body = await response.json();
    const selection: unknown = JSON.parse(body.choices?.[0]?.message?.content ?? "null");
    if (!selection || typeof selection !== "object") return fallback;
    const { questions } = selection as { questions?: unknown };
    if (!Array.isArray(questions) || questions.length < 2 || questions.length > 3 ||
      new Set(questions).size !== questions.length ||
      !questions.every((index) => Number.isInteger(index) && index >= 0 && index < QUESTIONS.length)) return fallback;
    return { ...fallback, questions: questions.map((index: number) => QUESTIONS[index]), source: "model" };
  } catch {
    return fallback;
  }
}

export const generateBriefing = action({
  args: prepArgs,
  returns: briefingValue,
  handler: async (ctx, args): Promise<Briefing> => {
    const data = await ctx.runMutation(prepare, { ...args, kind: "briefing" });
    if (data.briefing) return data.briefing;
    const value = await selectTemplates(templateBriefing(data.event), data.event.description);
    await ctx.runMutation(store, { ...args, fingerprint: data.fingerprint, value });
    return value;
  },
});

export const generateFollowup = action({
  args: { ...prepArgs, recipient: v.string() },
  returns: followupValue,
  handler: async (ctx, args): Promise<Followup> => {
    const recipient = cleanRecipient(args.recipient);
    const data = await ctx.runMutation(prepare, { deviceId: args.deviceId, eventId: args.eventId, kind: "followup", recipient });
    if (data.followup?.recipient === recipient) return data.followup;
    const value = templateFollowup(data.event, recipient);
    await ctx.runMutation(store, { deviceId: args.deviceId, eventId: args.eventId, fingerprint: data.fingerprint, value });
    return value;
  },
});

export const get = query({
  args: prepArgs,
  returns: v.object({ briefing: v.union(briefingValue, v.null()), followup: v.union(followupValue, v.null()) }),
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_device", (q) => q.eq("deviceId", args.deviceId)).unique();
    if (!user || !await ctx.db.get(args.eventId)) return { briefing: null, followup: null };
    const data = await load(ctx, args);
    return { briefing: data.briefing, followup: data.followup };
  },
});
