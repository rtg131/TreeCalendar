import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { rawEvent } from "./lib/rawEvent";

export const eventType = v.union(
  v.literal("hackathon"),
  v.literal("pitch_competition"),
  v.literal("demo_day"),
  v.literal("networking"),
  v.literal("workshop"),
  v.literal("talk"),
  v.literal("conference"),
  v.literal("career_fair"),
  v.literal("social"),
  v.literal("other"),
);

export const audience = v.union(
  v.literal("students"),
  v.literal("founders"),
  v.literal("investors"),
  v.literal("developers"),
  v.literal("general"),
);

export const role = v.union(v.literal("student"), v.literal("investor"), v.literal("host"));
export const verificationMode = v.union(v.literal("email"), v.literal("dev"));
export const claimStatus = v.union(v.literal("pending"), v.literal("approved"));

export const companyRole = v.union(v.literal("owner"), v.literal("member"));
export const connectionSide = v.union(v.literal("talent"), v.literal("company"));
export const connectionStatus = v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined"), v.literal("withdrawn"));

export const eventFields = {
  title: v.string(),
  description: v.string(),
  startTime: v.number(),
  endTime: v.optional(v.number()),
  timezone: v.string(),
  venue: v.optional(v.string()),
  address: v.optional(v.string()),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  city: v.string(),
  isOnline: v.boolean(),
  url: v.string(),
  imageUrl: v.optional(v.string()),
  organizerLogoUrl: v.optional(v.string()),
  source: v.string(),
  sourceId: v.string(),
  organizer: v.optional(v.string()),
  hosts: v.array(v.string()),
  tags: v.array(v.string()),
  eventType,
  audience: v.array(audience),
  investorScore: v.number(),
  investorSignals: v.array(v.string()),
};

export const normalizedEvent = v.object(eventFields);

export const eventPlace = v.object({
  venue: v.optional(v.string()),
  address: v.optional(v.string()),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  city: v.string(),
  isOnline: v.optional(v.boolean()),
});

export const eventSource = v.object({ url: v.string(), source: v.string(), sourceId: v.string() });

const { users: _authUsers, ...authOnlyTables } = authTables;

export default defineSchema({
  feeds: defineTable({
    source: v.string(),
    name: v.string(),
    url: v.string(),
    enabled: v.boolean(),
    intervalMinutes: v.number(),
    tier: v.optional(v.string()),
    lastFetchedAt: v.optional(v.number()),
    nextFetchAt: v.optional(v.number()),
    lastStatus: v.optional(v.union(v.literal("ok"), v.literal("error"))),
  })
    .index("by_url", ["url"])
    .index("by_source", ["source"])
    .index("by_enabled_nextFetchAt", ["enabled", "nextFetchAt"]),

  fetch_log: defineTable({
    feedId: v.id("feeds"),
    startedAt: v.number(),
    finishedAt: v.number(),
    durationMs: v.number(),
    status: v.union(v.literal("ok"), v.literal("error"), v.literal("skipped_robots")),
    rawCount: v.number(),
    insertedCount: v.number(),
    error: v.optional(v.string()),
  }).index("by_feed", ["feedId", "startedAt"]),

  robots_cache: defineTable({
    domain: v.string(),
    body: v.string(),
    fetchedAt: v.number(),
    expiresAt: v.number(),
  }).index("by_domain", ["domain"]),

  domain_rate: defineTable({
    domain: v.string(),
    nextAllowedAt: v.number(),
  }).index("by_domain", ["domain"]),

  raw_listings: defineTable({
    feedId: v.optional(v.id("feeds")),
    source: v.string(),
    sourceId: v.string(),
    raw: rawEvent,
    fetchedAt: v.number(),
    missingSince: v.optional(v.number()),
  })
    .index("by_source_sourceId", ["source", "sourceId"])
    .index("by_feed_missing_fetchedAt", ["feedId", "missingSince", "fetchedAt"]),

  events: defineTable({
    ...eventFields,
    rawListingId: v.optional(v.id("raw_listings")),
    lastSeenAt: v.number(),
    school: v.optional(v.string()),
    studentDensity: v.optional(v.number()),
    dedupeKey: v.optional(v.string()),
    sources: v.optional(v.array(eventSource)),
    synthetic: v.optional(v.boolean()),
    hiddenAt: v.optional(v.number()),
  })
    .index("by_start", ["startTime"])
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_school_start", ["school", "startTime"])
    .index("by_source_sourceId", ["source", "sourceId"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["city", "eventType", "source"],
    }),

  event_pages: defineTable({
    url: v.string(),
    status: v.union(v.literal("found"), v.literal("none"), v.literal("error")),
    place: v.optional(eventPlace),
    outsideBayArea: v.optional(v.boolean()),
    imageUrl: v.optional(v.string()),
    organizerLogoUrl: v.optional(v.string()),
    mediaChecked: v.optional(v.boolean()),
    error: v.optional(v.string()),
    fetchedAt: v.number(),
  }).index("by_url", ["url"]),

  geocode_cache: defineTable({
    key: v.string(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    city: v.optional(v.string()),
    fetchedAt: v.number(),
  }).index("by_key", ["key"]),

  users: defineTable({
    deviceId: v.string(),
    role,
    interests: v.array(v.string()),
    city: v.string(),
    lat: v.number(),
    lng: v.number(),
    locationSource: v.union(v.literal("device"), v.literal("city")),
    radiusKm: v.optional(v.number()),
    updatedAt: v.number(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    affiliation: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    priorRoles: v.optional(v.string()),
    experience: v.optional(v.string()),
    workEmail: v.optional(v.string()),
    workDomain: v.optional(v.string()),
    workEmailVerifiedAt: v.optional(v.number()),
    workEmailVerifiedVia: v.optional(verificationMode),
    emailVerificationTime: v.optional(v.number()),
    phoneVerificationTime: v.optional(v.number()),
    friendCode: v.optional(v.string()),
  })
    .index("by_device", ["deviceId"])
    .index("by_friend_code", ["friendCode"])
    .index("email", ["email"])
    .index("phone", ["phone"]),

  interests: defineTable({
    slug: v.string(),
    label: v.string(),
    emoji: v.string(),
    order: v.number(),
  }).index("by_slug", ["slug"]),

  link_submissions: defineTable({
    deviceId: v.string(),
    url: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("added"),
      v.literal("duplicate"),
      v.literal("needs_review"),
      v.literal("rejected"),
    ),
    eventIds: v.array(v.id("events")),
    error: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_device", ["deviceId", "createdAt"]),

  saves: defineTable({
    userId: v.id("users"),
    eventId: v.id("events"),
    savedAt: v.number(),
  })
    .index("by_user", ["userId", "savedAt"])
    .index("by_user_event", ["userId", "eventId"])
    .index("by_event", ["eventId"]),

  prep_briefings: defineTable({
    eventId: v.id("events"),
    fingerprint: v.string(),
    value: v.object({
      summary: v.string(),
      people: v.array(v.string()),
      questions: v.array(v.string()),
      tip: v.string(),
      source: v.union(v.literal("template"), v.literal("model")),
    }),
  }).index("by_event", ["eventId"]),

  prep_followups: defineTable({
    userId: v.id("users"),
    eventId: v.id("events"),
    fingerprint: v.string(),
    value: v.object({
      recipient: v.string(),
      linkedin: v.string(),
      email: v.string(),
      source: v.union(v.literal("template"), v.literal("model")),
    }),
  })
    .index("by_user_event", ["userId", "eventId"])
    .index("by_event", ["eventId"]),

  prep_rates: defineTable({
    userId: v.id("users"),
    requests: v.array(v.number()),
  }).index("by_user", ["userId"]),
  attendance: defineTable({
    userId: v.id("users"),
    eventId: v.id("events"),
    going: v.boolean(),
    attended: v.optional(v.boolean()),
    rating: v.optional(v.number()),
    investors: v.optional(v.union(v.literal("yes"), v.literal("no"), v.literal("unsure"))),
    note: v.optional(v.string()),
    dismissedAt: v.optional(v.number()),
    ratingScale: v.optional(v.literal(10)),
  })
    .index("by_user_event", ["userId", "eventId"])
    .index("by_user_going", ["userId", "going"])
    .index("by_user_attended", ["userId", "attended"])
    .index("by_event", ["eventId"])
    .index("by_rating_scale", ["ratingScale"]),

  attendance_totals: defineTable({
    eventId: v.id("events"),
    ratingCount: v.number(),
    ratingSum: v.number(),
    investorConfirmations: v.number(),
    ratingScale: v.optional(v.literal(10)),
  })
    .index("by_event", ["eventId"])
    .index("by_rating_scale", ["ratingScale"]),

  friendships: defineTable({
    requesterId: v.id("users"),
    addresseeId: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("accepted")),
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
  })
    .index("by_pair", ["requesterId", "addresseeId"])
    .index("by_addressee", ["addresseeId", "requesterId"]),

  friend_request_rates: defineTable({
    userId: v.id("users"),
    requests: v.array(v.number()),
  }).index("by_user", ["userId"]),

  companies: defineTable({
    name: v.string(),
    slug: v.string(),
    website: v.optional(v.string()),
    logo: v.optional(v.string()),
    createdAt: v.number(),
    verifiedAt: v.optional(v.number()),
    verifiedBy: v.optional(v.string()),
    domain: v.optional(v.string()),
  })
    .index("by_slug", ["slug"])
    .index("by_domain", ["domain"]),

  company_join_requests: defineTable({
    companyId: v.id("companies"),
    userId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_company", ["companyId", "userId"])
    .index("by_user", ["userId", "companyId"]),

  email_verifications: defineTable({
    userId: v.id("users"),
    deviceId: v.string(),
    email: v.string(),
    domain: v.string(),
    codeHash: v.string(),
    salt: v.string(),
    mode: verificationMode,
    attempts: v.number(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_device", ["deviceId", "createdAt"])
    .index("by_email", ["email", "createdAt"]),

  company_members: defineTable({
    companyId: v.id("companies"),
    userId: v.id("users"),
    role: companyRole,
    createdAt: v.number(),
  })
    .index("by_company", ["companyId", "userId"])
    .index("by_user", ["userId", "companyId"]),

  company_invites: defineTable({
    companyId: v.id("companies"),
    email: v.string(),
    invitedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_company", ["companyId", "email"])
    .index("by_email", ["email", "companyId"]),

  event_hosts: defineTable({
    eventId: v.id("events"),
    companyId: v.id("companies"),
    claimedBy: v.id("users"),
    status: v.optional(claimStatus),
    createdAt: v.number(),
  })
    .index("by_event", ["eventId", "companyId"])
    .index("by_company", ["companyId", "eventId"]),

  connections: defineTable({
    talentUserId: v.id("users"),
    companyId: v.id("companies"),
    eventId: v.optional(v.id("events")),
    initiatedBy: connectionSide,
    initiatorUserId: v.id("users"),
    status: connectionStatus,
    message: v.optional(v.string()),
    shareContact: v.boolean(),
    declinedBy: v.optional(connectionSide),
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
  })
    .index("by_pair", ["talentUserId", "companyId"])
    .index("by_talent_status", ["talentUserId", "status", "createdAt"])
    .index("by_company_status", ["companyId", "status", "createdAt"])
    .index("by_talent_initiated", ["talentUserId", "initiatedBy", "createdAt"])
    .index("by_company_initiated", ["companyId", "initiatedBy", "createdAt"])
    .index("by_event", ["eventId"]),

  messages: defineTable({
    connectionId: v.id("connections"),
    senderUserId: v.id("users"),
    body: v.string(),
    createdAt: v.number(),
  }).index("by_connection", ["connectionId", "createdAt"]),

  ...authOnlyTables,
});
