import { v, type Infer } from "convex/values";

export const rawLocation = v.object({
  online: v.boolean(),
  name: v.optional(v.string()),
  address: v.optional(v.string()),
  city: v.optional(v.string()),
  region: v.optional(v.string()),
  country: v.optional(v.string()),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
});

export const rawEvent = v.object({
  source: v.string(),
  sourceId: v.string(),
  title: v.string(),
  description: v.string(),
  url: v.string(),
  startsAt: v.string(),
  endsAt: v.optional(v.string()),
  timezone: v.string(),
  location: rawLocation,
  organizer: v.optional(v.string()),
  hosts: v.optional(v.array(v.string())),
  imageUrl: v.optional(v.string()),
  organizerLogoUrl: v.optional(v.string()),
  sourceTags: v.optional(v.array(v.string())),
  sourceEventType: v.optional(v.string()),
});

export type RawLocation = Infer<typeof rawLocation>;

/**
 * One listing as an adapter saw it, before normalizing.
 * startsAt / endsAt are ISO 8601 strings with a UTC offset (e.g. 2026-11-20T18:00:00-08:00);
 * timezone is the IANA zone the times were published in (e.g. America/Los_Angeles).
 */
export type RawEvent = Infer<typeof rawEvent>;
