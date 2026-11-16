import type { Adapter } from "../lib/adapter";
import { devpostAdapter } from "./devpost";
import { eventbriteAdapter } from "./eventbrite";
import { fixtureAdapter } from "./fixture";
import { icalAdapter } from "./ical";
import { jsonldAdapter } from "./jsonld";
import { llmExtractAdapter } from "./llm/adapter";
import { lumaAdapter } from "./luma";
import { mlhAdapter } from "./mlh";

export const ADAPTERS: Record<string, Adapter> = {
  [devpostAdapter.source]: devpostAdapter,
  [eventbriteAdapter.source]: eventbriteAdapter,
  [jsonldAdapter.source]: jsonldAdapter,
  [lumaAdapter.source]: lumaAdapter,
  [mlhAdapter.source]: mlhAdapter,
  [icalAdapter.source]: icalAdapter,
  [fixtureAdapter.source]: fixtureAdapter,
  [llmExtractAdapter.source]: llmExtractAdapter,
};

export const TIER_ADAPTERS: Record<string, Adapter> = {
  "JSON-LD": jsonldAdapter,
  extraction: llmExtractAdapter,
};

export function resolveAdapter(feed: { source: string; tier?: string }): Adapter | undefined {
  return ADAPTERS[feed.source] ?? (feed.tier ? TIER_ADAPTERS[feed.tier] : undefined);
}

export const RETIRED_DEFAULT_FEED_URLS = [
  "https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&challenge_type[]=in-person",
];

export const DEFAULT_FEEDS: { source: string; name: string; url: string; intervalMinutes: number; enabled?: boolean; tier?: string }[] = [
  {
    source: "devpost",
    name: "Devpost: in-person open/upcoming (all)",
    url: "https://devpost.com/api/hackathons?challenge_type[]=in-person&status[]=upcoming&status[]=open",
    intervalMinutes: 360,
    tier: "feed",
  },
  {
    source: "devpost",
    name: "Devpost online hackathons",
    url: "https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&challenge_type[]=online",
    intervalMinutes: 720,
    tier: "feed",
  },
  { source: "mlh", name: "MLH 2027 season", url: "https://www.mlh.com/seasons/2027/events", intervalMinutes: 720, enabled: false },
  { source: "luma", name: "Luma San Francisco", url: "https://luma.com/sf", intervalMinutes: 180, enabled: false },
  { source: "luma", name: "Luma: The AI Collective", url: "https://luma.com/genai-collective", intervalMinutes: 360, enabled: false },
  { source: "luma", name: "Luma: Claude Community Events", url: "https://luma.com/claudecommunity", intervalMinutes: 360, enabled: false },
  { source: "luma", name: "Luma: Latent Space", url: "https://luma.com/ls", intervalMinutes: 720, enabled: false },
];
