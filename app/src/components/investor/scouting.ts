import type { InvestorEvent } from "../../../../convex/investor";
import { INVESTORS_LIKELY_MIN } from "../../../../convex/lib/ranking";
import { SCHOOLS } from "../../../../convex/lib/scouting";

export type { InvestorEvent };

export type TypeFilter = "all" | "pitch" | "hackathon" | "networking";
export type DateFilter = "any" | "week" | "month";
export type Filters = { school: string | null; type: TypeFilter; date: DateFilter };

const DAY = 86_400_000;

const TYPE_MATCH: Record<Exclude<TypeFilter, "all">, InvestorEvent["eventType"][]> = {
  pitch: ["pitch_competition", "demo_day"],
  hackathon: ["hackathon"],
  networking: ["networking", "career_fair", "social"],
};

export function applyFilters(list: InvestorEvent[], f: Filters, now: number): InvestorEvent[] {
  const horizon = f.date === "week" ? now + 7 * DAY : f.date === "month" ? now + 30 * DAY : Infinity;
  return list.filter(
    (e) => (f.school === null || e.school === f.school) && (f.type === "all" || TYPE_MATCH[f.type].includes(e.eventType)) && e.startTime <= horizon,
  );
}

const startedLongRunning = (e: InvestorEvent, now: number) => e.startTime < now && e.endTime !== undefined && e.endTime - e.startTime > 2 * DAY;

export function weekShortlist(list: InvestorEvent[], now: number, size = 3): InvestorEvent[] {
  return list.filter((e) => e.startTime <= now + 7 * DAY && !startedLongRunning(e, now) && e.investorScore >= INVESTORS_LIKELY_MIN).slice(0, size);
}

export function schoolsIn(list: InvestorEvent[]): string[] {
  const present = new Set(list.map((e) => e.school));
  return SCHOOLS.map(([name]) => name).filter((name) => present.has(name));
}
