import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { ended } from "./attendanceModel";
import { callerFor, isVerifiedHost, requireCaller, requireHost } from "./lib/identity";
import {
  blockedUntil, COMPANY_DAILY_LIMIT, companyRole, companyView, connectionSide, connectionStatus, DAY, eventSummary, fail,
  hosts, isLive, isMember, MAX_DISCOVER_EVENTS, MAX_EVENT_TALENT, MAX_INBOX, MAX_MEMBERSHIPS, MAX_MESSAGE, MAX_ROWS, cleanText, nullableStatus, pairRows, requireEligible, requireMember, requireVerified, isApproved, profileView, toProfile, sharedContact,
  sideOf, TALENT_DAILY_LIMIT, talentView, toCompany, toContact, toEvent, toTalent, wentTo, type Side,
} from "./lib/connections";
import { nextMessageTime } from "./chat";

const common = {
  _id: v.id("connections"),
  status: connectionStatus,
  initiatedBy: connectionSide,
  message: v.union(v.string(), v.null()),
  createdAt: v.number(),
  respondedAt: v.union(v.number(), v.null()),
  event: v.union(eventSummary, v.null()),
};
const talentConnection = v.object({ ...common, shareContact: v.boolean(), company: companyView });
const companyConnection = v.object({ ...common, talent: talentView, contact: v.union(sharedContact, v.null()) });
const buckets = <T extends typeof talentConnection | typeof companyConnection>(item: T) =>
  v.object({ incoming: v.array(item), outgoing: v.array(item), connected: v.array(item) });
const initiateResult = v.object({ connectionId: v.id("connections"), status: v.union(v.literal("pending"), v.literal("accepted")) });

async function commonView(ctx: QueryCtx, c: Doc<"connections">) {
  const event = c.eventId ? await ctx.db.get(c.eventId) : null;
  return {
    _id: c._id, status: c.status, initiatedBy: c.initiatedBy, message: c.message ?? null,
    createdAt: c.createdAt, respondedAt: c.respondedAt ?? null, event: event ? toEvent(event) : null,
  };
}

async function initiate(
  ctx: MutationCtx, side: Side, talent: Doc<"users">, companyId: Id<"companies">, eventId: Id<"events">,
  initiator: Doc<"users">, rawMessage: string | undefined,
) {
  const message = cleanText(rawMessage, MAX_MESSAGE, "Message");
  const now = Date.now();
  const rows = await pairRows(ctx, talent._id, companyId);
  const live = rows.find(isLive);
  if (live?.status === "accepted" || (live && live.initiatedBy === side)) return { connectionId: live._id, status: live.status as "pending" | "accepted" };
  if (live) {
    await ctx.db.patch(live._id, { status: "accepted", respondedAt: now });
    if (message) await ctx.db.insert("messages", { connectionId: live._id, senderUserId: initiator._id, body: message, createdAt: await nextMessageTime(ctx, live._id) });
    return { connectionId: live._id, status: "accepted" as const };
  }
  const until = blockedUntil(rows, side, now);
  if (until !== null) fail("blocked", `This connection was declined. You can try again after ${new Date(until).toISOString().slice(0, 10)}`);
  const recent = side === "talent"
    ? await ctx.db.query("connections").withIndex("by_talent_initiated", (q) => q.eq("talentUserId", talent._id).eq("initiatedBy", "talent").gt("createdAt", now - DAY)).take(TALENT_DAILY_LIMIT)
    : await ctx.db.query("connections").withIndex("by_company_initiated", (q) => q.eq("companyId", companyId).eq("initiatedBy", "company").gt("createdAt", now - DAY)).take(COMPANY_DAILY_LIMIT);
  const limit = side === "talent" ? TALENT_DAILY_LIMIT : COMPANY_DAILY_LIMIT;
  if (recent.length >= limit) fail("rate_limited", `At most ${limit} new interests per day`);
  const connectionId = await ctx.db.insert("connections", {
    talentUserId: talent._id, companyId, eventId, initiatedBy: side, initiatorUserId: initiator._id,
    status: "pending", shareContact: false, createdAt: now, ...(message ? { message } : {}),
  });
  return { connectionId, status: "pending" as const };
}

export const expressInterest = mutation({
  args: { deviceId: v.string(), companyId: v.id("companies"), eventId: v.id("events"), message: v.optional(v.string()) },
  returns: initiateResult,
  handler: async (ctx, { deviceId, companyId, eventId, message }) => {
    const user = await requireCaller(ctx, deviceId);
    await requireVerified(ctx, companyId);
    await requireEligible(ctx, user, companyId, eventId);
    return initiate(ctx, "talent", user, companyId, eventId, user, message);
  },
});

export const expressInterestInTalent = mutation({
  args: { deviceId: v.string(), companyId: v.id("companies"), talentUserId: v.id("users"), eventId: v.id("events"), message: v.optional(v.string()) },
  returns: initiateResult,
  handler: async (ctx, { deviceId, companyId, talentUserId, eventId, message }) => {
    const user = await requireCaller(ctx, deviceId);
    await requireMember(ctx, companyId, user);
    await requireVerified(ctx, companyId);
    const talent = await ctx.db.get(talentUserId);
    if (!talent) return fail("not_found", "Talent not found");
    await requireEligible(ctx, talent, companyId, eventId);
    return initiate(ctx, "company", talent, companyId, eventId, user, message);
  },
});

async function loadForCaller(ctx: QueryCtx, deviceId: string, connectionId: Id<"connections">) {
  const user = await requireCaller(ctx, deviceId);
  const connection = await ctx.db.get(connectionId);
  const side = connection ? await sideOf(ctx, connection, user._id) : null;
  if (!connection || !side) return fail("not_found", "Connection not found");
  if (side === "company") requireHost(user);
  return { user, connection, side };
}

export const respond = mutation({
  args: { deviceId: v.string(), connectionId: v.id("connections"), accept: v.boolean() },
  returns: v.object({ status: connectionStatus }),
  handler: async (ctx, { deviceId, connectionId, accept }) => {
    const { connection, side } = await loadForCaller(ctx, deviceId, connectionId);
    const now = Date.now();
    if (connection.status === "pending") {
      if (connection.initiatedBy === side) fail("forbidden", "Wait for the other side to respond, or withdraw instead");
      await requireVerified(ctx, connection.companyId);
      const status = accept ? "accepted" as const : "declined" as const;
      await ctx.db.patch(connectionId, { status, respondedAt: now, ...(accept ? {} : { declinedBy: side }) });
      return { status };
    }
    if (connection.status === "accepted") {
      if (accept) return { status: "accepted" as const };
      await ctx.db.patch(connectionId, { status: "declined", respondedAt: now, declinedBy: side });
      return { status: "declined" as const };
    }
    return fail("invalid", "This connection is closed");
  },
});

export const withdraw = mutation({
  args: { deviceId: v.string(), connectionId: v.id("connections") },
  returns: v.null(),
  handler: async (ctx, { deviceId, connectionId }) => {
    const { connection, side } = await loadForCaller(ctx, deviceId, connectionId);
    if (connection.status !== "pending" || connection.initiatedBy !== side) fail("forbidden", "Only a pending request you sent can be withdrawn");
    await ctx.db.patch(connectionId, { status: "withdrawn", respondedAt: Date.now() });
    return null;
  },
});

export const setShareContact = mutation({
  args: { deviceId: v.string(), connectionId: v.id("connections"), shareContact: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { deviceId, connectionId, shareContact }) => {
    const { connection, side } = await loadForCaller(ctx, deviceId, connectionId);
    if (side !== "talent") fail("forbidden", "Only the talent can share their contact details");
    if (!isLive(connection)) fail("invalid", "This connection is closed");
    await ctx.db.patch(connectionId, { shareContact });
    return null;
  },
});

export const inbox = query({
  args: { deviceId: v.string() },
  returns: v.object({
    talent: buckets(talentConnection),
    companies: v.array(v.object({ company: companyView, role: companyRole, ...buckets(companyConnection).fields })),
  }),
  handler: async (ctx, { deviceId }) => {
    const empty = <T>() => ({ incoming: [] as T[], outgoing: [] as T[], connected: [] as T[] });
    const user = await callerFor(ctx, deviceId);
    if (!user) return { talent: empty<typeof talentConnection.type>(), companies: [] };
    const place = <T>(into: ReturnType<typeof empty<T>>, c: Doc<"connections">, me: Side, view: T) =>
      (c.status === "accepted" ? into.connected : c.initiatedBy === me ? into.outgoing : into.incoming).push(view);
    const live = async (field: "talentUserId" | "companyId", id: Id<"users"> | Id<"companies">) => (await Promise.all((["pending", "accepted"] as const).map((status) =>
      field === "talentUserId"
        ? ctx.db.query("connections").withIndex("by_talent_status", (q) => q.eq("talentUserId", id as Id<"users">).eq("status", status)).order("desc").take(MAX_INBOX)
        : ctx.db.query("connections").withIndex("by_company_status", (q) => q.eq("companyId", id as Id<"companies">).eq("status", status)).order("desc").take(MAX_INBOX),
    ))).flat();

    const talent = empty<typeof talentConnection.type>();
    for (const c of await live("talentUserId", user._id)) {
      const company = await ctx.db.get(c.companyId);
      if (company) place(talent, c, "talent", { ...await commonView(ctx, c), shareContact: c.shareContact, company: toCompany(company) });
    }

    const memberships = isVerifiedHost(user) ? await ctx.db.query("company_members").withIndex("by_user", (q) => q.eq("userId", user._id)).take(MAX_MEMBERSHIPS) : [];
    const companies = [];
    for (const m of memberships) {
      const company = await ctx.db.get(m.companyId);
      if (!company) continue;
      const bucket = empty<typeof companyConnection.type>();
      for (const c of await live("companyId", company._id)) {
        const person = await ctx.db.get(c.talentUserId);
        if (!person) continue;
        place(bucket, c, "company", {
          ...await commonView(ctx, c),
          talent: toTalent(person),
          contact: c.status === "accepted" && c.shareContact ? toContact(person) : null,
        });
      }
      companies.push({ company: toCompany(company), role: m.role, ...bucket });
    }
    return { talent, companies };
  },
});

export const discover = query({
  args: { deviceId: v.string() },
  returns: v.array(v.object({
    event: eventSummary,
    companies: v.array(v.object({ company: companyView, connectionStatus: nullableStatus, blockedUntil: v.union(v.number(), v.null()) })),
  })),
  handler: async (ctx, { deviceId }) => {
    const user = await callerFor(ctx, deviceId);
    if (!user || user.role !== "student") return [];
    const now = Date.now();
    const records = await ctx.db.query("attendance").withIndex("by_user_event", (q) => q.eq("userId", user._id)).order("desc").take(MAX_DISCOVER_EVENTS);
    const out = [];
    for (const record of records) {
      const event = await ctx.db.get(record.eventId);
      if (!event || !ended(event, now) || !wentTo(record, event)) continue;
      const links = (await ctx.db.query("event_hosts").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(MAX_ROWS)).filter(isApproved);
      const companies = [];
      for (const link of links) {
        const company = await ctx.db.get(link.companyId);
        if (!company || company.verifiedAt === undefined) continue;
        const rows = await pairRows(ctx, user._id, company._id);
        const latest = rows.find(isLive) ?? rows.sort((a, b) => b.createdAt - a.createdAt)[0];
        companies.push({ company: toCompany(company), connectionStatus: latest?.status ?? null, blockedUntil: blockedUntil(rows, "talent", now) });
      }
      if (companies.length) out.push({ event: toEvent(event), companies });
    }
    return out.sort((a, b) => b.event.startTime - a.event.startTime);
  },
});

export const eventTalent = query({
  args: { deviceId: v.string(), companyId: v.id("companies"), eventId: v.id("events") },
  returns: v.array(v.object({ talent: talentView, connectionStatus: nullableStatus, blockedUntil: v.union(v.number(), v.null()) })),
  handler: async (ctx, { deviceId, companyId, eventId }) => {
    const user = await requireCaller(ctx, deviceId);
    await requireMember(ctx, companyId, user);
    await requireVerified(ctx, companyId);
    const event = await ctx.db.get(eventId);
    const now = Date.now();
    if (!event || !ended(event, now) || !await hosts(ctx, companyId, eventId)) return [];
    const records = (await ctx.db.query("attendance").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(MAX_EVENT_TALENT)).filter((r) => wentTo(r, event));
    const out = [];
    for (const record of records) {
      const person = await ctx.db.get(record.userId);
      if (!person || person.role !== "student" || person._id === user._id) continue;
      if (await isMember(ctx, companyId, person._id)) continue;
      const rows = await pairRows(ctx, person._id, companyId);
      const latest = rows.find(isLive) ?? rows.sort((a, b) => b.createdAt - a.createdAt)[0];
      out.push({ talent: toTalent(person), connectionStatus: latest?.status ?? null, blockedUntil: blockedUntil(rows, "company", now) });
    }
    return out;
  },
});

export const talentProfile = query({
  args: { deviceId: v.string(), companyId: v.id("companies"), talentUserId: v.id("users") },
  returns: v.object({ ...profileView.fields, sharedEvents: v.array(eventSummary) }),
  handler: async (ctx, { deviceId, companyId, talentUserId }) => {
    const user = await requireCaller(ctx, deviceId);
    await requireMember(ctx, companyId, user);
    await requireVerified(ctx, companyId);
    const talent = await ctx.db.get(talentUserId);
    if (!talent || talent.role !== "student" || await isMember(ctx, companyId, talentUserId)) return fail("not_found", "Talent not found");
    const now = Date.now();
    const links = (await ctx.db.query("event_hosts").withIndex("by_company", (q) => q.eq("companyId", companyId)).take(MAX_ROWS)).filter(isApproved);
    const sharedEvents = [];
    for (const link of links) {
      const event = await ctx.db.get(link.eventId);
      if (!event || !ended(event, now)) continue;
      const record = await ctx.db.query("attendance").withIndex("by_user_event", (q) => q.eq("userId", talentUserId).eq("eventId", event._id)).unique();
      if (wentTo(record, event)) sharedEvents.push(event);
    }
    const live = (await pairRows(ctx, talentUserId, companyId)).find(isLive) ?? null;
    if (!sharedEvents.length && !live) return fail("not_found", "Talent not found");
    return { ...toProfile(talent, live), sharedEvents: sharedEvents.sort((a, b) => b.startTime - a.startTime).map(toEvent) };
  },
});
