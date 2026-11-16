import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { checkContactField } from "./lib/contact";
import { emailMode, sendVerificationEmail } from "./lib/email";
import { emailDomain, isFreeMailDomain } from "./lib/freeMail";
import { callerFor, isVerifiedHost, requireCaller, requireHostCaller } from "./lib/identity";
import {
  blockedUntil, canReviewClaim, claimOf, eventSummary, fail, hostSlugs, isApproved, isLive, isMember, MAX_EVENT_TALENT, MAX_MEMBERSHIPS, MAX_ROWS, onDomain,
  pairRows, profileView, requireMember, requireVerified, toEvent, toProfile, wentTo,
} from "./lib/connections";
import { claimStatus, role, verificationMode } from "./schema";

const HOUR = 3_600_000;
const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const SENDS_PER_HOUR = 3;

const hex = (bytes: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
const hashCode = async (salt: string, code: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${code}`)));

function newCode() {
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return String(n % 1_000_000).padStart(6, "0");
}

const latestFor = (ctx: QueryCtx, userId: Id<"users">) =>
  ctx.db.query("email_verifications").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").first();

export const createVerification = internalMutation({
  args: { deviceId: v.string(), workEmail: v.string(), codeHash: v.string(), salt: v.string(), mode: verificationMode },
  returns: v.object({ verificationId: v.id("email_verifications"), email: v.string(), expiresAt: v.number() }),
  handler: async (ctx, { deviceId, workEmail, codeHash, salt, mode }) => {
    const user = await requireCaller(ctx, deviceId);
    if (user.role !== "host") fail("host_required", "Choose \"I'm a host\" before verifying a work email");
    const checked = checkContactField("email", workEmail);
    if ("error" in checked) return fail("invalid", checked.error);
    const email = checked.value;
    const domain = emailDomain(email);
    if (isFreeMailDomain(domain)) fail("personal_email", "Use your work or school email, not a personal address");
    const now = Date.now();
    const [byDevice, byEmail] = await Promise.all([
      ctx.db.query("email_verifications").withIndex("by_device", (q) => q.eq("deviceId", deviceId).gt("createdAt", now - HOUR)).take(SENDS_PER_HOUR),
      ctx.db.query("email_verifications").withIndex("by_email", (q) => q.eq("email", email).gt("createdAt", now - HOUR)).take(SENDS_PER_HOUR),
    ]);
    if (byDevice.length >= SENDS_PER_HOUR || byEmail.length >= SENDS_PER_HOUR) fail("rate_limited", "Too many codes requested. Try again in an hour.");
    const expiresAt = now + CODE_TTL_MS;
    const verificationId = await ctx.db.insert("email_verifications", {
      userId: user._id, deviceId, email, domain, codeHash, salt, mode, attempts: 0, expiresAt, createdAt: now,
    });
    return { verificationId, email, expiresAt };
  },
});

export const dropVerification = internalMutation({
  args: { verificationId: v.id("email_verifications") },
  returns: v.null(),
  handler: async (ctx, { verificationId }) => {
    if (await ctx.db.get(verificationId)) await ctx.db.delete(verificationId);
    return null;
  },
});

export const pendingSalt = internalQuery({
  args: { deviceId: v.string() },
  returns: v.union(v.null(), v.object({ verificationId: v.id("email_verifications"), salt: v.string() })),
  handler: async (ctx, { deviceId }) => {
    const user = await callerFor(ctx, deviceId);
    const latest = user ? await latestFor(ctx, user._id) : null;
    return latest ? { verificationId: latest._id, salt: latest.salt } : null;
  },
});

const codeError = v.union(v.literal("invalid_code"), v.literal("code_expired"), v.literal("too_many_attempts"));

export const checkCode = internalMutation({
  args: { deviceId: v.string(), verificationId: v.id("email_verifications"), codeHash: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), workEmail: v.string(), workDomain: v.string(), verificationMode }),
    v.object({ ok: v.literal(false), error: codeError }),
  ),
  handler: async (ctx, { deviceId, verificationId, codeHash }) => {
    const user = await requireCaller(ctx, deviceId);
    const row = await latestFor(ctx, user._id);
    if (!row || row._id !== verificationId) return { ok: false as const, error: "invalid_code" as const };
    if (row.attempts >= MAX_ATTEMPTS) return { ok: false as const, error: "too_many_attempts" as const };
    if (row.expiresAt <= Date.now()) return { ok: false as const, error: "code_expired" as const };
    if (row.codeHash !== codeHash) {
      await ctx.db.patch(row._id, { attempts: row.attempts + 1 });
      return { ok: false as const, error: row.attempts + 1 >= MAX_ATTEMPTS ? "too_many_attempts" as const : "invalid_code" as const };
    }
    await ctx.db.patch(user._id, { workEmail: row.email, workDomain: row.domain, workEmailVerifiedAt: Date.now(), workEmailVerifiedVia: row.mode });
    await ctx.db.delete(row._id);
    return { ok: true as const, workEmail: row.email, workDomain: row.domain, verificationMode: row.mode };
  },
});

export const startVerification = action({
  args: { deviceId: v.string(), workEmail: v.string() },
  returns: v.object({ sentTo: v.string(), expiresAt: v.number(), verificationMode, devCode: v.optional(v.string()) }),
  handler: async (ctx, { deviceId, workEmail }): Promise<{ sentTo: string; expiresAt: number; verificationMode: "email" | "dev"; devCode?: string }> => {
    const mode = emailMode();
    const code = newCode();
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    const created: { verificationId: Id<"email_verifications">; email: string; expiresAt: number } = await ctx.runMutation(internal.hosts.createVerification, { deviceId, workEmail, codeHash: await hashCode(salt, code), salt, mode });
    try {
      const sent = await sendVerificationEmail(created.email, code);
      return { sentTo: created.email, expiresAt: created.expiresAt, verificationMode: sent.mode, ...(sent.mode === "dev" ? { devCode: sent.devCode } : {}) };
    } catch (error) {
      await ctx.runMutation(internal.hosts.dropVerification, { verificationId: created.verificationId });
      throw error;
    }
  },
});

const CODE_MESSAGES = { invalid_code: "That code isn't right", code_expired: "That code has expired. Request a new one.", too_many_attempts: "Too many wrong codes. Request a new one." };

export const confirmVerification = action({
  args: { deviceId: v.string(), code: v.string() },
  returns: v.object({ workEmail: v.string(), workDomain: v.string(), verificationMode }),
  handler: async (ctx, { deviceId, code }): Promise<{ workEmail: string; workDomain: string; verificationMode: "email" | "dev" }> => {
    const digits = code.replace(/\s+/g, "");
    const pending: { verificationId: Id<"email_verifications">; salt: string } | null = await ctx.runQuery(internal.hosts.pendingSalt, { deviceId });
    if (!pending || !/^\d{6}$/.test(digits)) throw new ConvexError({ code: "invalid_code", message: CODE_MESSAGES.invalid_code });
    const result: { ok: true; workEmail: string; workDomain: string; verificationMode: "email" | "dev" } | { ok: false; error: keyof typeof CODE_MESSAGES } = await ctx.runMutation(internal.hosts.checkCode, { deviceId, verificationId: pending.verificationId, codeHash: await hashCode(pending.salt, digits) });
    if (!result.ok) throw new ConvexError({ code: result.error, message: CODE_MESSAGES[result.error] });
    return { workEmail: result.workEmail, workDomain: result.workDomain, verificationMode: result.verificationMode };
  },
});

export const status = query({
  args: { deviceId: v.string() },
  returns: v.object({
    role: v.union(role, v.null()),
    verified: v.boolean(),
    workEmail: v.union(v.string(), v.null()),
    workDomain: v.union(v.string(), v.null()),
    verificationMode: v.union(verificationMode, v.null()),
    pending: v.union(v.null(), v.object({ email: v.string(), expiresAt: v.number(), attemptsLeft: v.number(), verificationMode })),
  }),
  handler: async (ctx, { deviceId }) => {
    const user = await callerFor(ctx, deviceId);
    if (!user) return { role: null, verified: false, workEmail: null, workDomain: null, verificationMode: null, pending: null };
    const latest = await latestFor(ctx, user._id);
    const live = latest && latest.expiresAt > Date.now() && latest.attempts < MAX_ATTEMPTS ? latest : null;
    return {
      role: user.role,
      verified: isVerifiedHost(user),
      workEmail: user.workEmail ?? null,
      workDomain: user.workDomain ?? null,
      verificationMode: user.workEmailVerifiedAt !== undefined ? user.workEmailVerifiedVia ?? "email" : null,
      pending: live ? { email: live.email, expiresAt: live.expiresAt, attemptsLeft: MAX_ATTEMPTS - live.attempts, verificationMode: live.mode } : null,
    };
  },
});

async function verifiedMemberships(ctx: QueryCtx, user: Doc<"users">) {
  const rows = await ctx.db.query("company_members").withIndex("by_user", (q) => q.eq("userId", user._id)).take(MAX_MEMBERSHIPS);
  const companies = await Promise.all(rows.map((r) => ctx.db.get(r.companyId)));
  return companies.filter((c) => c !== null && c.verifiedAt !== undefined) as Doc<"companies">[];
}

const claimResult = v.object({ claimId: v.id("event_hosts"), status: claimStatus, companyId: v.id("companies") });

export const claimHosting = mutation({
  args: { deviceId: v.string(), eventId: v.id("events"), companyId: v.optional(v.id("companies")) },
  returns: claimResult,
  handler: async (ctx, { deviceId, eventId, companyId: chosen }) => {
    const user = await requireHostCaller(ctx, deviceId);
    let companyId = chosen;
    if (!companyId) {
      const rows = await ctx.db.query("company_members").withIndex("by_user", (q) => q.eq("userId", user._id)).take(MAX_MEMBERSHIPS);
      if (!rows.length) fail("host_required", "Create or join a company before claiming events");
      if (rows.length > 1) fail("invalid", "You belong to several companies. Pass companyId.");
      companyId = rows[0].companyId;
    }
    await requireMember(ctx, companyId, user);
    const company = await requireVerified(ctx, companyId);
    const event = await ctx.db.get(eventId);
    if (!event) return fail("not_found", "Event not found");
    const auto = hostSlugs(event).includes(company.slug) || (company.domain !== undefined && onDomain(event, company.domain));
    const existing = await claimOf(ctx, companyId, eventId);
    if (existing) {
      if (!isApproved(existing) && auto) await ctx.db.patch(existing._id, { status: "approved" });
      return { claimId: existing._id, status: isApproved(existing) || auto ? "approved" as const : "pending" as const, companyId };
    }
    const status = auto ? "approved" as const : "pending" as const;
    const claimId = await ctx.db.insert("event_hosts", { eventId, companyId, claimedBy: user._id, status, createdAt: Date.now() });
    return { claimId, status, companyId };
  },
});

export const reviewClaim = mutation({
  args: { deviceId: v.string(), claimId: v.id("event_hosts"), approve: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { deviceId, claimId, approve }) => {
    const user = await requireCaller(ctx, deviceId);
    const claim = await ctx.db.get(claimId);
    if (!claim) return fail("not_found", "Claim not found");
    await requireMember(ctx, claim.companyId, user);
    const company = await requireVerified(ctx, claim.companyId);
    if (isApproved(claim)) return null;
    if (!canReviewClaim(claim, company, user)) fail("forbidden", "Only another member with a verified email at the company's domain can review this claim");
    if (approve) await ctx.db.patch(claimId, { status: "approved" });
    else await ctx.db.delete(claimId);
    return null;
  },
});

export const hostingStatus = query({
  args: { deviceId: v.string(), eventId: v.id("events") },
  returns: v.object({ canClaim: v.boolean(), claim: v.union(v.null(), v.object({ ...claimResult.fields, canReview: v.boolean() })) }),
  handler: async (ctx, { deviceId, eventId }) => {
    const user = await callerFor(ctx, deviceId);
    if (!user || !isVerifiedHost(user) || !await ctx.db.get(eventId)) return { canClaim: false, claim: null };
    const companies = await verifiedMemberships(ctx, user);
    const claims = (await Promise.all(companies.map((c) => claimOf(ctx, c._id, eventId)))).filter((c) => c !== null);
    const best = claims.find(isApproved) ?? claims[0] ?? null;
    const company = best ? companies.find((c) => c._id === best.companyId) : undefined;
    return {
      canClaim: claims.length < companies.length,
      claim: best ? {
        claimId: best._id, status: isApproved(best) ? "approved" as const : "pending" as const, companyId: best.companyId,
        canReview: canReviewClaim(best, company, user),
      } : null,
    };
  },
});

export const eventMatches = query({
  args: { deviceId: v.string(), eventId: v.id("events"), companyId: v.id("companies") },
  returns: v.object({
    event: eventSummary,
    matches: v.array(v.object({ ...profileView.fields, attended: v.boolean(), interested: v.boolean(), mutual: v.boolean(), blockedUntil: v.union(v.number(), v.null()) })),
  }),
  handler: async (ctx, { deviceId, eventId, companyId }) => {
    const user = await requireCaller(ctx, deviceId);
    await requireMember(ctx, companyId, user);
    await requireVerified(ctx, companyId);
    const event = await ctx.db.get(eventId);
    if (!event) return fail("not_found", "Event not found");
    if (!isApproved(await claimOf(ctx, companyId, eventId))) fail("forbidden", "Claim this event and get it approved first");

    const now = Date.now();
    const rows = new Map<Id<"users">, { talent: Doc<"users">; attended: boolean; live: Doc<"connections"> | null; blockedUntil: number | null }>();
    const attendance = await ctx.db.query("attendance").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(MAX_EVENT_TALENT);
    for (const record of attendance) {
      if (!wentTo(record, event)) continue;
      const talent = await ctx.db.get(record.userId);
      if (!talent || talent.role !== "student" || await isMember(ctx, companyId, talent._id)) continue;
      const pair = await pairRows(ctx, talent._id, companyId);
      rows.set(talent._id, { talent, attended: true, live: pair.find(isLive) ?? null, blockedUntil: blockedUntil(pair, "company", now) });
    }
    const linked = (await ctx.db.query("connections").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(MAX_ROWS))
      .filter((c) => c.companyId === companyId && isLive(c));
    for (const connection of linked) {
      if (rows.has(connection.talentUserId)) continue;
      const talent = await ctx.db.get(connection.talentUserId);
      if (talent) rows.set(talent._id, { talent, attended: false, live: connection, blockedUntil: blockedUntil(await pairRows(ctx, talent._id, companyId), "company", now) });
    }

    const rank = (live: Doc<"connections"> | null) =>
      !live ? 3 : live.status === "accepted" ? 0 : live.initiatedBy === "talent" ? 1 : 2;
    const matches = [...rows.values()]
      .sort((a, b) => rank(a.live) - rank(b.live) || (a.talent.name ?? "").localeCompare(b.talent.name ?? "") || a.talent._id.localeCompare(b.talent._id))
      .map(({ talent, attended, live, blockedUntil }) => ({
        blockedUntil,
        ...toProfile(talent, live),
        attended,
        interested: live !== null && (live.initiatedBy === "talent" || live.status === "accepted"),
        mutual: live?.status === "accepted",
      }));
    return { event: toEvent(event), matches };
  },
});
