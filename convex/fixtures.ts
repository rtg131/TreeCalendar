import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { ensureUser, writeGoing } from "./attendanceModel";
import { nextMessageTime } from "./chat";
import { deleteFriendshipsOf, friendshipBetween } from "./lib/friends";
import { requireCaller } from "./lib/identity";
import { claimOf, cleanText, connectionStatus, endOf, fail, MAX_BODY, membershipOf } from "./lib/connections";
import { isFixtureUrl, PAST_TEST_EVENT_ID, PAST_TEST_EVENT_TITLE } from "./lib/fixtures";
import { sourcesOf } from "./normalize/dedupe";
import { deleteEventRefs } from "./normalize/reassignEventRefs";

const BATCH = 100;
const HOUR = 3_600_000;
const FIXTURE_SOURCE = "cac-fixtures";
const MATCH_EVENT_ID = "cac-scout-test-match-event";
const MATCH_COMPANY = { name: "Scout Test Co", slug: "scout-test-co", domain: "scout-test.example" };
const MATCH_MEMBER_DEVICE = "fixture-scout-test-co-member";
const VERIFIED_BY = "fixture";

export const seedTalentMatch = mutation({
  args: { deviceId: v.string() },
  returns: v.object({ companyId: v.id("companies"), eventId: v.id("events"), memberDeviceId: v.string(), memberUserId: v.id("users") }),
  handler: async (ctx, { deviceId }) => {
    if (process.env.ENABLE_TEST_FIXTURES !== "1") throw new Error("seedTalentMatch requires ENABLE_TEST_FIXTURES=1");
    if (deviceId === MATCH_MEMBER_DEVICE) throw new Error("seedTalentMatch needs a talent device, not the fixture member");
    const userId = await ensureUser(ctx, deviceId);
    if ((await ctx.db.get(userId))!.role !== "student") throw new Error("seedTalentMatch needs a device whose user is a student");
    const now = Date.now();

    const company = await ctx.db.query("companies").withIndex("by_slug", (q) => q.eq("slug", MATCH_COMPANY.slug)).unique();
    const companyId = company?._id ?? await ctx.db.insert("companies", {
      ...MATCH_COMPANY, website: `https://${MATCH_COMPANY.domain}`, createdAt: now, verifiedAt: now, verifiedBy: VERIFIED_BY,
    });
    if (company && company.verifiedAt === undefined) await ctx.db.patch(companyId, { verifiedAt: now, verifiedBy: VERIFIED_BY });

    const member = await ctx.db.query("users").withIndex("by_device", (q) => q.eq("deviceId", MATCH_MEMBER_DEVICE)).unique();
    const memberUserId = member?._id ?? await ctx.db.insert("users", {
      deviceId: MATCH_MEMBER_DEVICE, role: "host", name: "Scout Test Co Recruiter", interests: ["startups"],
      city: "San Francisco", lat: 37.7749, lng: -122.4194, locationSource: "city", updatedAt: now,
      workEmail: `recruiter@${MATCH_COMPANY.domain}`, workDomain: MATCH_COMPANY.domain, workEmailVerifiedAt: now, workEmailVerifiedVia: "dev",
    });
    if (!await membershipOf(ctx, companyId, memberUserId)) await ctx.db.insert("company_members", { companyId, userId: memberUserId, role: "owner", createdAt: now });

    const existing = await ctx.db
      .query("events")
      .withIndex("by_source_sourceId", (q) => q.eq("source", FIXTURE_SOURCE).eq("sourceId", MATCH_EVENT_ID))
      .unique();
    const eventId = existing?._id ?? await ctx.db.insert("events", {
      title: "[TEST] Scout fixture demo day",
      description: "Synthetic test data for CAC end-to-end tests, not a real event. A past demo day hosted by Scout Test Co used to exercise talent interest and chat.",
      startTime: now - 28 * HOUR, endTime: now - 26 * HOUR, timezone: "America/Los_Angeles",
      venue: "CAC Test Venue", address: "1 Market St, San Francisco, CA 94105", lat: 37.7941, lng: -122.3951,
      city: "San Francisco", isOnline: false, url: `https://${MATCH_COMPANY.domain}/events/${MATCH_EVENT_ID}`,
      source: FIXTURE_SOURCE, sourceId: MATCH_EVENT_ID, organizer: MATCH_COMPANY.name, hosts: [MATCH_COMPANY.name], tags: ["test"],
      eventType: "demo_day", audience: ["students"], investorScore: 0, investorSignals: [], lastSeenAt: now, synthetic: true,
    });

    const claim = await claimOf(ctx, companyId, eventId);
    if (!claim) await ctx.db.insert("event_hosts", { eventId, companyId, claimedBy: memberUserId, status: "approved", createdAt: now });
    else if (claim.status === "pending") await ctx.db.patch(claim._id, { status: "approved" });

    const record = (await ctx.db.get((await writeGoing(ctx, userId, eventId, true))!))!;
    const event = (await ctx.db.get(eventId))!;
    if (record._creationTime >= endOf(event)) {
      const endTime = Math.floor(record._creationTime) + 1;
      await ctx.db.patch(eventId, { startTime: endTime - 2 * HOUR, endTime });
    }
    return { companyId, eventId, memberDeviceId: MATCH_MEMBER_DEVICE, memberUserId };
  },
});

async function purgeMatchCompany(ctx: MutationCtx) {
  const company = await ctx.db.query("companies").withIndex("by_slug", (q) => q.eq("slug", MATCH_COMPANY.slug)).unique();
  if (company?.verifiedBy === VERIFIED_BY) {
    const connections = await ctx.db.query("connections").withIndex("by_company_status", (q) => q.eq("companyId", company._id)).take(BATCH);
    for (const connection of connections) {
      for (const message of await ctx.db.query("messages").withIndex("by_connection", (q) => q.eq("connectionId", connection._id)).collect()) await ctx.db.delete(message._id);
      await ctx.db.delete(connection._id);
    }
    if (connections.length === BATCH) return true;
    const rows = await Promise.all([
      ctx.db.query("event_hosts").withIndex("by_company", (q) => q.eq("companyId", company._id)).collect(),
      ctx.db.query("company_members").withIndex("by_company", (q) => q.eq("companyId", company._id)).collect(),
      ctx.db.query("company_invites").withIndex("by_company", (q) => q.eq("companyId", company._id)).collect(),
      ctx.db.query("company_join_requests").withIndex("by_company", (q) => q.eq("companyId", company._id)).collect(),
    ]);
    for (const row of rows.flat()) await ctx.db.delete(row._id);
    await ctx.db.delete(company._id);
  }
  const member = await ctx.db.query("users").withIndex("by_device", (q) => q.eq("deviceId", MATCH_MEMBER_DEVICE)).unique();
  if (member) {
    const rows = await Promise.all([
      ctx.db.query("company_members").withIndex("by_user", (q) => q.eq("userId", member._id)).collect(),
      ctx.db.query("company_join_requests").withIndex("by_user", (q) => q.eq("userId", member._id)).collect(),
      ctx.db.query("email_verifications").withIndex("by_user", (q) => q.eq("userId", member._id)).collect(),
    ]);
    for (const row of rows.flat()) await ctx.db.delete(row._id);
    await deleteFriendshipsOf(ctx, member._id);
    await ctx.db.delete(member._id);
  }
  return false;
}

const DEMO_EVENT_ID = "cac-scout-demo-host-event";
const DEMO_COMPANY = { name: "Northwind Labs", slug: "scout-demo-northwind", domain: "scout-demo.example" };
const DEMO_TALENT_PREFIX = "fixture-scout-demo-talent-";
const MINUTE = 60_000;
const DEMO_TALENT = [
  { name: "Priya Raman", affiliation: "UC Berkeley, EECS", priorRoles: "ML intern at a Series A robotics startup",
    experience: "Built a vision pipeline that cut pick errors by a third on a warehouse arm. Now researching small multimodal models for on-device inference." },
  { name: "Marcus Ellery", affiliation: "Stanford, CS", priorRoles: "Founding engineer at a two-person dev tools startup",
    experience: "Shipped a code review bot used by forty teams before the startup wound down. Interested in agent tooling and evaluation." },
  { name: "Sofia Navarro", affiliation: "UCSF, Bioengineering", priorRoles: "Research assistant in a protein design lab",
    experience: "Trained diffusion models for binder design on a shared GPU cluster. Looking to apply generative models to diagnostics." },
  { name: "Daniel Okafor", affiliation: "San Jose State, Software Engineering", priorRoles: "Backend intern at a fintech payments company",
    experience: "Rebuilt a reconciliation service in Go and halved its nightly runtime. Spends weekends on retrieval-augmented search side projects." },
  { name: "Hana Takeda", affiliation: "UC Berkeley, Data Science", priorRoles: "Product analyst intern at a consumer social app",
    experience: "Ran growth experiments that lifted week-one retention by four points. Learning to fine-tune LLMs for content ranking." },
  { name: "Leo Brandt", affiliation: "Santa Clara University, Computer Engineering", priorRoles: "Hardware hacker and hackathon organizer",
    experience: "Led a team that won a regional hackathon with a voice-controlled lab assistant. Wants to work where AI meets embedded systems." },
];
const DEMO_CHAT = [
  { fromTalent: false, body: "Great meeting you at the builders night. Want to grab a call about our applied ML role?" },
  { fromTalent: true, body: "Thanks for reaching out! I'd love that. I'm free most afternoons next week." },
  { fromTalent: false, body: "Perfect, I'll send over a few times for Tuesday." },
];

async function dropConnection(ctx: MutationCtx, connectionId: Id<"connections">) {
  await dropMessages(ctx, connectionId);
  await ctx.db.delete(connectionId);
}

async function dropMessages(ctx: MutationCtx, connectionId: Id<"connections">) {
  for (const message of await ctx.db.query("messages").withIndex("by_connection", (q) => q.eq("connectionId", connectionId)).collect()) await ctx.db.delete(message._id);
}

async function upsertDemoTalent(ctx: MutationCtx, i: number, now: number) {
  const profile = DEMO_TALENT[i];
  const deviceId = `${DEMO_TALENT_PREFIX}${i + 1}`;
  const fields = { role: "student" as const, ...profile, updatedAt: now };
  const found = await ctx.db.query("users").withIndex("by_device", (q) => q.eq("deviceId", deviceId)).unique();
  const userId = found?._id ?? await ctx.db.insert("users", {
    deviceId, interests: ["ai", "startups"], city: "San Francisco", lat: 37.7749, lng: -122.4194, locationSource: "city", ...fields,
  });
  if (found) await ctx.db.patch(userId, fields);
  return { userId, deviceId, name: profile.name };
}

const demoCompany = (ctx: MutationCtx) => ctx.db.query("companies").withIndex("by_slug", (q) => q.eq("slug", DEMO_COMPANY.slug)).unique();

export const seedHostDemo = mutation({
  args: { deviceId: v.string() },
  returns: v.object({
    companyId: v.id("companies"), eventId: v.id("events"),
    mutualConnectionId: v.id("connections"), pendingConnectionId: v.id("connections"),
    talent: v.array(v.object({ userId: v.id("users"), deviceId: v.string(), name: v.string() })),
  }),
  handler: async (ctx, { deviceId }) => {
    if (process.env.ENABLE_TEST_FIXTURES !== "1") throw new Error("seedHostDemo requires ENABLE_TEST_FIXTURES=1");
    if (deviceId.startsWith("fixture-")) throw new Error("seedHostDemo needs a demo host device, not a fixture device");
    const now = Date.now();
    const userId = await ensureUser(ctx, deviceId);
    const user = (await ctx.db.get(userId))!;
    await ctx.db.patch(userId, {
      role: "host", ...(user.name ? {} : { name: "Demo Host" }), updatedAt: now,
      workEmail: `host@${DEMO_COMPANY.domain}`, workDomain: DEMO_COMPANY.domain, workEmailVerifiedAt: now, workEmailVerifiedVia: "dev",
    });

    const company = await demoCompany(ctx);
    const companyId = company?._id ?? await ctx.db.insert("companies", {
      ...DEMO_COMPANY, website: `https://${DEMO_COMPANY.domain}`, createdAt: now, verifiedAt: now, verifiedBy: VERIFIED_BY,
    });
    if (company && company.verifiedAt === undefined) await ctx.db.patch(companyId, { verifiedAt: now, verifiedBy: VERIFIED_BY });
    const membership = await membershipOf(ctx, companyId, userId);
    if (!membership) await ctx.db.insert("company_members", { companyId, userId, role: "owner", createdAt: now });
    else if (membership.role !== "owner") await ctx.db.patch(membership._id, { role: "owner" });

    const existing = await ctx.db
      .query("events")
      .withIndex("by_source_sourceId", (q) => q.eq("source", FIXTURE_SOURCE).eq("sourceId", DEMO_EVENT_ID))
      .unique();
    const eventId = existing?._id ?? await ctx.db.insert("events", {
      title: "[TEST] Northwind AI builders night",
      description: "Synthetic test data for the CAC host demo, not a real event. A past evening of AI demos hosted by Northwind Labs.",
      startTime: now - 27 * HOUR, endTime: now - 24 * HOUR, timezone: "America/Los_Angeles",
      venue: "CAC Test Venue", address: "1 Market St, San Francisco, CA 94105", lat: 37.7941, lng: -122.3951,
      city: "San Francisco", isOnline: false, url: `https://${DEMO_COMPANY.domain}/events/${DEMO_EVENT_ID}`,
      source: FIXTURE_SOURCE, sourceId: DEMO_EVENT_ID, organizer: DEMO_COMPANY.name, hosts: [DEMO_COMPANY.name], tags: ["test"],
      eventType: "networking", audience: ["students"], investorScore: 0, investorSignals: [], lastSeenAt: now, synthetic: true,
    });
    const claim = await claimOf(ctx, companyId, eventId);
    if (!claim) await ctx.db.insert("event_hosts", { eventId, companyId, claimedBy: userId, status: "approved", createdAt: now });
    else if (claim.status === "pending") await ctx.db.patch(claim._id, { status: "approved" });

    const talent = [];
    let latest = 0;
    for (let i = 0; i < DEMO_TALENT.length; i++) {
      const person = await upsertDemoTalent(ctx, i, now);
      const record = (await ctx.db.get((await writeGoing(ctx, person.userId, eventId, true))!))!;
      if (record.attended === false) await ctx.db.patch(record._id, { attended: undefined });
      latest = Math.max(latest, record._creationTime);
      talent.push(person);
    }
    const event = (await ctx.db.get(eventId))!;
    if (latest >= endOf(event)) {
      const endTime = Math.floor(latest) + 1;
      await ctx.db.patch(eventId, { startTime: endTime - 3 * HOUR, endTime });
    }

    const reset = async (talentUserId: Id<"users">) => {
      const [keep, ...rest] = await ctx.db.query("connections").withIndex("by_pair", (q) => q.eq("talentUserId", talentUserId).eq("companyId", companyId)).collect();
      for (const row of rest) await dropConnection(ctx, row._id);
      return keep;
    };
    for (const { userId: talentUserId } of talent.slice(2)) {
      const keep = await reset(talentUserId);
      if (keep) await dropConnection(ctx, keep._id);
    }

    const [mutualTalent, pendingTalent] = talent;
    const mutual = {
      talentUserId: mutualTalent.userId, companyId, eventId, initiatedBy: "company" as const, initiatorUserId: userId, status: "accepted" as const,
      message: "Loved your demo. Want to chat about our applied ML team?", shareContact: false,
      declinedBy: undefined, createdAt: now - 40 * MINUTE, respondedAt: now - 35 * MINUTE,
    };
    const mutualKeep = await reset(mutualTalent.userId);
    const mutualConnectionId = mutualKeep?._id ?? await ctx.db.insert("connections", mutual);
    if (mutualKeep) {
      await ctx.db.patch(mutualConnectionId, mutual);
      await dropMessages(ctx, mutualConnectionId);
    }
    for (const [i, { fromTalent, body }] of DEMO_CHAT.entries()) {
      await ctx.db.insert("messages", { connectionId: mutualConnectionId, senderUserId: fromTalent ? mutualTalent.userId : userId, body, createdAt: now - (30 - 10 * i) * MINUTE });
    }

    const pending = {
      talentUserId: pendingTalent.userId, companyId, eventId, initiatedBy: "talent" as const, initiatorUserId: pendingTalent.userId, status: "pending" as const,
      message: "Really enjoyed the talk on agent evals. Would love to hear about internships.", shareContact: false,
      declinedBy: undefined, createdAt: now - 20 * MINUTE, respondedAt: undefined,
    };
    const pendingKeep = await reset(pendingTalent.userId);
    const pendingConnectionId = pendingKeep?._id ?? await ctx.db.insert("connections", pending);
    if (pendingKeep) {
      await ctx.db.patch(pendingConnectionId, pending);
      await dropMessages(ctx, pendingConnectionId);
    }

    return { companyId, eventId, mutualConnectionId, pendingConnectionId, talent };
  },
});

const FRIENDS_EVENT_ID = "cac-friends-demo-event";

export const seedFriendsDemo = mutation({
  args: { deviceId: v.string() },
  returns: v.object({ friendUserIds: v.array(v.id("users")), incomingRequestId: v.id("friendships"), goingEventId: v.id("events") }),
  handler: async (ctx, { deviceId }) => {
    if (process.env.ENABLE_TEST_FIXTURES !== "1") throw new Error("seedFriendsDemo requires ENABLE_TEST_FIXTURES=1");
    if (deviceId.startsWith("fixture-")) throw new Error("seedFriendsDemo needs a demo device, not a fixture device");
    const now = Date.now();
    const userId = await ensureUser(ctx, deviceId);
    const [first, second, incoming] = await Promise.all([0, 1, 2].map((i) => upsertDemoTalent(ctx, i, now)));

    const link = async (talentId: Id<"users">, status: "pending" | "accepted") => {
      const fields = { requesterId: talentId, addresseeId: userId, status, createdAt: now - 2 * HOUR, respondedAt: status === "accepted" ? now - HOUR : undefined };
      const existing = await friendshipBetween(ctx, talentId, userId);
      if (!existing) return ctx.db.insert("friendships", fields);
      await ctx.db.replace(existing._id, fields);
      return existing._id;
    };
    await link(first.userId, "accepted");
    await link(second.userId, "accepted");
    const incomingRequestId = await link(incoming.userId, "pending");

    const existing = await ctx.db
      .query("events")
      .withIndex("by_source_sourceId", (q) => q.eq("source", FIXTURE_SOURCE).eq("sourceId", FRIENDS_EVENT_ID))
      .unique();
    const goingEventId = existing?._id ?? await ctx.db.insert("events", {
      title: "[TEST] Friends demo hack night",
      description: "Synthetic test data for the CAC friends demo, not a real event. An upcoming hack night a demo friend is going to.",
      startTime: now + 48 * HOUR, endTime: now + 51 * HOUR, timezone: "America/Los_Angeles",
      venue: "CAC Test Venue", address: "1 Market St, San Francisco, CA 94105", lat: 37.7941, lng: -122.3951,
      city: "San Francisco", isOnline: false, url: `https://example.com/${FRIENDS_EVENT_ID}`,
      source: FIXTURE_SOURCE, sourceId: FRIENDS_EVENT_ID, organizer: "CAC test fixtures", hosts: [], tags: ["test"],
      eventType: "hackathon", audience: ["students"], investorScore: 0, investorSignals: [], lastSeenAt: now, synthetic: true,
    });
    const event = (await ctx.db.get(goingEventId))!;
    if (event.startTime <= now) await ctx.db.patch(goingEventId, { startTime: now + 48 * HOUR, endTime: now + 51 * HOUR });
    await writeGoing(ctx, first.userId, goingEventId, true);

    return { friendUserIds: [first.userId, second.userId], incomingRequestId, goingEventId };
  },
});

export const demoTalentRespond = mutation({
  args: { deviceId: v.string(), connectionId: v.id("connections"), accept: v.boolean(), message: v.optional(v.string()) },
  returns: v.object({ status: connectionStatus }),
  handler: async (ctx, { deviceId, connectionId, accept, message }) => {
    if (process.env.ENABLE_TEST_FIXTURES !== "1") throw new Error("demoTalentRespond requires ENABLE_TEST_FIXTURES=1");
    const user = await requireCaller(ctx, deviceId);
    const [company, connection] = await Promise.all([demoCompany(ctx), ctx.db.get(connectionId)]);
    const talent = connection ? await ctx.db.get(connection.talentUserId) : null;
    if (!company || !connection || !talent || connection.companyId !== company._id || !talent.deviceId.startsWith(DEMO_TALENT_PREFIX)
      || !await membershipOf(ctx, company._id, user._id)) return fail("forbidden", "Only a demo company member can answer for demo talent");
    const body = cleanText(message, MAX_BODY, "Message");
    let status = connection.status;
    if (status === "pending" && connection.initiatedBy === "company") {
      status = accept ? "accepted" : "declined";
      await ctx.db.patch(connectionId, { status, respondedAt: Date.now(), ...(accept ? {} : { declinedBy: "talent" as const }) });
    }
    if (body) await ctx.db.insert("messages", { connectionId, senderUserId: talent._id, body, createdAt: await nextMessageTime(ctx, connectionId) });
    return { status };
  },
});

async function purgeDemoCompany(ctx: MutationCtx) {
  const company = await demoCompany(ctx);
  if (company?.verifiedBy === VERIFIED_BY) {
    const connections = await ctx.db.query("connections").withIndex("by_company_status", (q) => q.eq("companyId", company._id)).take(BATCH);
    for (const connection of connections) await dropConnection(ctx, connection._id);
    if (connections.length === BATCH) return true;
    const rows = await Promise.all([
      ctx.db.query("event_hosts").withIndex("by_company", (q) => q.eq("companyId", company._id)).collect(),
      ctx.db.query("company_members").withIndex("by_company", (q) => q.eq("companyId", company._id)).collect(),
      ctx.db.query("company_invites").withIndex("by_company", (q) => q.eq("companyId", company._id)).collect(),
      ctx.db.query("company_join_requests").withIndex("by_company", (q) => q.eq("companyId", company._id)).collect(),
    ]);
    for (const row of rows.flat()) await ctx.db.delete(row._id);
    await ctx.db.delete(company._id);
  }
  for (let i = 1; i <= DEMO_TALENT.length; i++) {
    const talent = await ctx.db.query("users").withIndex("by_device", (q) => q.eq("deviceId", `${DEMO_TALENT_PREFIX}${i}`)).unique();
    if (!talent) continue;
    for (const connection of await ctx.db.query("connections").withIndex("by_talent_status", (q) => q.eq("talentUserId", talent._id)).collect()) await dropConnection(ctx, connection._id);
    await deleteFriendshipsOf(ctx, talent._id);
    const rows = await Promise.all([
      ctx.db.query("attendance").withIndex("by_user_event", (q) => q.eq("userId", talent._id)).collect(),
      ctx.db.query("saves").withIndex("by_user", (q) => q.eq("userId", talent._id)).collect(),
      ctx.db.query("company_members").withIndex("by_user", (q) => q.eq("userId", talent._id)).collect(),
    ]);
    for (const row of rows.flat()) await ctx.db.delete(row._id);
    await ctx.db.delete(talent._id);
  }
  return false;
}

export const seedPastCommitment = mutation({
  args: { deviceId: v.string() },
  returns: v.object({ eventId: v.id("events"), commitmentId: v.id("attendance") }),
  handler: async (ctx, { deviceId }) => {
    if (process.env.ENABLE_TEST_FIXTURES !== "1") throw new Error("seedPastCommitment requires ENABLE_TEST_FIXTURES=1");
    const userId = await ensureUser(ctx, deviceId);
    const existing = await ctx.db
      .query("events")
      .withIndex("by_source_sourceId", (q) => q.eq("source", FIXTURE_SOURCE).eq("sourceId", PAST_TEST_EVENT_ID))
      .unique();
    const now = Date.now();
    const eventId = existing?._id ?? await ctx.db.insert("events", {
      title: PAST_TEST_EVENT_TITLE,
      description: "Synthetic test data for CAC end-to-end tests, not a real event. A past evening hack night used to exercise the check-in card.",
      startTime: now - 28 * HOUR, endTime: now - 26 * HOUR, timezone: "America/Los_Angeles",
      venue: "CAC Test Venue", address: "1 Market St, San Francisco, CA 94105", lat: 37.7941, lng: -122.3951,
      city: "San Francisco", isOnline: false, url: `https://example.com/${PAST_TEST_EVENT_ID}`,
      source: FIXTURE_SOURCE, sourceId: PAST_TEST_EVENT_ID, organizer: "CAC test fixtures", hosts: [], tags: ["test"],
      eventType: "hackathon", audience: ["students"], investorScore: 0, investorSignals: [], lastSeenAt: now, synthetic: true,
    });
    const commitmentId = (await writeGoing(ctx, userId, eventId, true))!;
    return { eventId, commitmentId };
  },
});

export const purgeSynthetic = internalMutation({
  args: {},
  returns: v.object({ events: v.number(), rawListings: v.number(), linkSubmissions: v.number(), saves: v.number(), more: v.boolean() }),
  handler: async (ctx) => {
    if (process.env.ENABLE_TEST_FIXTURES !== "1") throw new Error("purgeSynthetic requires ENABLE_TEST_FIXTURES=1");
    const events = await ctx.db
      .query("events")
      .filter((q) => q.eq(q.field("synthetic"), true))
      .take(BATCH);
    const purged = new Set<Id<"events">>(events.map((e) => e._id));
    const counts = { events: 0, rawListings: 0, linkSubmissions: 0, saves: 0 };
    for (const event of events) {
      const removed = await deleteEventRefs(ctx, event._id);
      counts.saves += removed.saves;

      const listingIds = new Set<Id<"raw_listings">>(event.rawListingId ? [event.rawListingId] : []);
      for (const { source, sourceId } of sourcesOf(event)) {
        const listings = await ctx.db
          .query("raw_listings")
          .withIndex("by_source_sourceId", (q) => q.eq("source", source).eq("sourceId", sourceId))
          .collect();
        for (const listing of listings) listingIds.add(listing._id);
      }
      for (const id of listingIds) {
        if (!(await ctx.db.get(id))) continue;
        await ctx.db.delete(id);
        counts.rawListings++;
      }
      await ctx.db.delete(event._id);
      counts.events++;
    }

    for (const submission of await ctx.db.query("link_submissions").collect()) {
      const remaining = submission.eventIds.filter((id) => !purged.has(id));
      if (isFixtureUrl(submission.url)) {
        await ctx.db.delete(submission._id);
        counts.linkSubmissions++;
      } else if (remaining.length !== submission.eventIds.length) {
        await ctx.db.patch(submission._id, { eventIds: remaining });
      }
    }

    const more = events.length === BATCH || await purgeMatchCompany(ctx) || await purgeDemoCompany(ctx);
    if (more) await ctx.scheduler.runAfter(0, internal.fixtures.purgeSynthetic, {});
    return { ...counts, more };
  },
});
