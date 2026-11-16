import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { ended } from "../attendanceModel";
import { companyRole, connectionSide, connectionStatus, role } from "../schema";
import { requireHost } from "./identity";

export const DAY = 86_400_000;
export const BLOCK_MS = 30 * DAY;
export const TALENT_DAILY_LIMIT = 20;
export const COMPANY_DAILY_LIMIT = 50;
export const MAX_MESSAGE = 500;
export const MAX_BODY = 2000;
export const MAX_ROWS = 1000;
export const MAX_PAIR_ROWS = 100;
export const MAX_INBOX = 100;
export const MAX_MEMBERSHIPS = 20;
export const MAX_DISCOVER_EVENTS = 200;
export const MAX_EVENT_TALENT = 500;

export type Side = "talent" | "company";
export type ErrorCode = "not_onboarded" | "not_found" | "forbidden" | "not_eligible" | "blocked" | "rate_limited" | "invalid" | "company_unverified"
  | "host_required" | "personal_email" | "email_not_configured" | "invalid_code" | "code_expired" | "too_many_attempts" | "domain_taken";

export const fail = (code: ErrorCode, message: string): never => {
  throw new ConvexError({ code, message });
};

export const slugify = (name: string) =>
  name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export const companyView = v.object({
  _id: v.id("companies"),
  name: v.string(),
  slug: v.string(),
  website: v.optional(v.string()),
  logo: v.optional(v.string()),
  verified: v.boolean(),
});
export const eventSummary = v.object({
  _id: v.id("events"),
  title: v.string(),
  startTime: v.number(),
  endTime: v.optional(v.number()),
});
export const talentView = v.object({ userId: v.id("users"), name: v.union(v.string(), v.null()), role });
export const sharedContact = v.object({
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  linkedin: v.optional(v.string()),
  affiliation: v.optional(v.string()),
});
export const nullableStatus = v.union(connectionStatus, v.null());
export { companyRole, connectionSide, connectionStatus };

export const toCompany = ({ _id, name, slug, website, logo, verifiedAt }: Doc<"companies">) => ({
  _id, name, slug, ...(website === undefined ? {} : { website }), ...(logo === undefined ? {} : { logo }), verified: verifiedAt !== undefined,
});

export async function requireVerified(ctx: QueryCtx, companyId: Id<"companies">) {
  const company = await ctx.db.get(companyId);
  if (!company) return fail("not_found", "Company not found");
  if (company.verifiedAt === undefined) fail("company_unverified", "This company is waiting for verification");
  return company;
}
export const toEvent = ({ _id, title, startTime, endTime }: Doc<"events">) => ({
  _id, title, startTime, ...(endTime === undefined ? {} : { endTime }),
});
export const toTalent = (user: Doc<"users">) => ({ userId: user._id, name: user.name ?? null, role: user.role });
export function toContact(user: Doc<"users">) {
  const contact: { email?: string; phone?: string; linkedin?: string; affiliation?: string } = {};
  for (const field of ["email", "phone", "linkedin", "affiliation"] as const) if (user[field] !== undefined) contact[field] = user[field];
  return contact;
}

export const membershipOf = (ctx: QueryCtx, companyId: Id<"companies">, userId: Id<"users">) =>
  ctx.db.query("company_members").withIndex("by_company", (q) => q.eq("companyId", companyId).eq("userId", userId)).unique();

export async function isMember(ctx: QueryCtx, companyId: Id<"companies">, userId: Id<"users">) {
  return (await membershipOf(ctx, companyId, userId)) !== null;
}

export async function requireMember(ctx: QueryCtx, companyId: Id<"companies">, user: Doc<"users">) {
  requireHost(user);
  const membership = await membershipOf(ctx, companyId, user._id);
  if (!membership) fail("forbidden", "Only members of this company can do that");
  return membership!;
}

export const claimOf = (ctx: QueryCtx, companyId: Id<"companies">, eventId: Id<"events">) =>
  ctx.db.query("event_hosts").withIndex("by_event", (q) => q.eq("eventId", eventId).eq("companyId", companyId)).unique();

export const isApproved = (claim: Doc<"event_hosts"> | null) => claim !== null && claim.status !== "pending";

export const hosts = async (ctx: QueryCtx, companyId: Id<"companies">, eventId: Id<"events">) => isApproved(await claimOf(ctx, companyId, eventId));

export const canReviewClaim = (claim: Doc<"event_hosts">, company: Doc<"companies"> | null | undefined, user: Doc<"users">) =>
  !isApproved(claim) && claim.claimedBy !== user._id && company?.domain !== undefined && company.domain === user.workDomain;

export const hostSlugs = (event: Doc<"events">) => [...event.hosts, ...(event.organizer ? [event.organizer] : [])].map(slugify);

export function onDomain(event: Doc<"events">, domain: string) {
  return [event.url, ...(event.sources ?? []).map((s) => s.url)].some((raw) => {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      return host === domain || host.endsWith(`.${domain}`);
    } catch {
      return false;
    }
  });
}

export const profileView = v.object({
  talent: v.object({
    ...talentView.fields,
    affiliation: v.union(v.string(), v.null()),
    priorRoles: v.union(v.string(), v.null()),
    experience: v.union(v.string(), v.null()),
  }),
  connection: v.union(v.null(), v.object({ _id: v.id("connections"), status: connectionStatus, initiatedBy: connectionSide, shareContact: v.boolean() })),
  contact: v.union(sharedContact, v.null()),
});

export const toProfile = (talent: Doc<"users">, live: Doc<"connections"> | null) => ({
  talent: { ...toTalent(talent), affiliation: talent.affiliation ?? null, priorRoles: talent.priorRoles ?? null, experience: talent.experience ?? null },
  connection: live ? { _id: live._id, status: live.status, initiatedBy: live.initiatedBy, shareContact: live.shareContact } : null,
  contact: live?.status === "accepted" && live.shareContact ? toContact(talent) : null,
});

export const endOf = (event: Doc<"events">) => event.endTime ?? event.startTime + 3 * 3_600_000;

export const wentTo = (record: Doc<"attendance"> | null, event: Doc<"events">) =>
  record !== null && record._creationTime < endOf(event) && record.attended !== false && (record.going || record.attended === true);

export async function requireEligible(ctx: QueryCtx, talent: Doc<"users">, companyId: Id<"companies">, eventId: Id<"events">) {
  if (talent.role !== "student") fail("not_eligible", "Only Talent profiles can connect with companies");
  const event = await ctx.db.get(eventId);
  if (!event) fail("not_found", "Event not found");
  if (!ended(event!, Date.now())) fail("not_eligible", "Connections open after the event ends");
  if (!await hosts(ctx, companyId, eventId)) fail("not_eligible", "This company did not host that event");
  const record = await ctx.db.query("attendance").withIndex("by_user_event", (q) => q.eq("userId", talent._id).eq("eventId", eventId)).unique();
  if (!wentTo(record, event!)) fail("not_eligible", "Talent must have been going to or checked in to the event");
  if (await isMember(ctx, companyId, talent._id)) fail("not_eligible", "You are a member of this company");
  return event!;
}

export const pairRows = (ctx: QueryCtx, talentUserId: Id<"users">, companyId: Id<"companies">) =>
  ctx.db.query("connections").withIndex("by_pair", (q) => q.eq("talentUserId", talentUserId).eq("companyId", companyId)).take(MAX_PAIR_ROWS);

export const isLive = (c: Doc<"connections">) => c.status === "pending" || c.status === "accepted";

export function blockedUntil(rows: Doc<"connections">[], side: Side, now: number) {
  const until = rows
    .filter((c) => c.status === "declined" && c.declinedBy !== undefined && c.declinedBy !== side)
    .map((c) => (c.respondedAt ?? c.createdAt) + BLOCK_MS);
  const latest = until.length ? Math.max(...until) : 0;
  return latest > now ? latest : null;
}

export async function sideOf(ctx: QueryCtx, connection: Doc<"connections">, userId: Id<"users">): Promise<Side | null> {
  if (connection.talentUserId === userId) return "talent";
  return (await isMember(ctx, connection.companyId, userId)) ? "company" : null;
}

export function cleanText(raw: string | undefined, max: number, label: string) {
  if (raw === undefined) return undefined;
  const text = raw.trim();
  if (Array.from(text).length > max) fail("invalid", `${label} must be at most ${max} characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) fail("invalid", `${label} contains control characters`);
  return text || undefined;
}
