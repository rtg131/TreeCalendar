import type { Doc } from "../_generated/dataModel";
import { distanceKm } from "./geo";

export type RankInput = {
  interests: string[];
  role: "student" | "investor" | "host";
  lat: number;
  lng: number;
  now: number;
};

export type Ranked = {
  event: Doc<"events">;
  score: number;
  distanceKm: number | null;
  matched: string[];
};

export const INVESTORS_LIKELY_MIN = 70;

const DAY = 86_400_000;

export function scoreEvent(event: Doc<"events">, input: RankInput): Ranked {
  const matched = event.tags.filter((t) => input.interests.includes(t));
  const interest = Math.min(1, matched.length / Math.max(1, Math.min(3, input.interests.length)));

  const daysAway = Math.max(0, (event.startTime - input.now) / DAY);
  const longRunning = event.endTime !== undefined && event.endTime - event.startTime > 2 * DAY;
  const soonness = longRunning && event.startTime < input.now ? 0.4 : 1 / (1 + daysAway / 7);

  const km = event.lat !== undefined && event.lng !== undefined ? distanceKm(input, { lat: event.lat, lng: event.lng }) : null;
  const proximity = event.isOnline ? 0.35 : km === null ? 0.5 : 1 / (1 + km / 15);

  const investorWeight = input.role === "investor" ? 0.25 : 0.08;
  const score = 0.45 * interest + 0.3 * soonness + 0.25 * proximity + investorWeight * (event.investorScore / 100);

  return { event, score, distanceKm: km === null ? null : Math.round(km * 10) / 10, matched };
}

export function rankEvents(events: Doc<"events">[], input: RankInput): Ranked[] {
  return events.map((e) => scoreEvent(e, input)).sort((a, b) => b.score - a.score);
}
