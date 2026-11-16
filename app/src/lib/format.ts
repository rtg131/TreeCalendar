const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY = 86_400_000;
export const DEFAULT_DURATION = 3 * 3600_000;

export function formatTime(ms: number) {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function dateBadge(ms: number) {
  const d = new Date(ms);
  return { month: MONTHS[d.getMonth()].toUpperCase(), day: String(d.getDate()) };
}

const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
const daysFromToday = (ms: number, now: number) => Math.round((startOfDay(ms) - startOfDay(now)) / DAY);

export function isPast(start: number, end: number | undefined, now = Date.now()) {
  return (end ?? start + DEFAULT_DURATION) < now;
}

export function relativeDay(start: number, end: number | undefined, now = Date.now()) {
  if (start <= now && (end ?? start + DEFAULT_DURATION) >= now) {
    return end && daysFromToday(end, now) > 0 ? `Happening now · until ${DAYS[new Date(end).getDay()]}` : "Happening now";
  }
  const days = daysFromToday(start, now);
  if (days === 0) return `Today, ${formatTime(start)}`;
  if (days === 1) return `Tomorrow, ${formatTime(start)}`;
  if (days > 1 && days < 7) return `${DAYS[new Date(start).getDay()]}, ${formatTime(start)}`;
  const s = new Date(start);
  return `${DAYS[s.getDay()]}, ${MONTHS[s.getMonth()]} ${s.getDate()}`;
}

export function longWhen(start: number, end?: number): [string, string] {
  const s = new Date(start);
  const main = `${LONG_DAYS[s.getDay()]}, ${LONG_MONTHS[s.getMonth()]} ${s.getDate()}`;
  if (!end) return [main, `${formatTime(start)}, end time not listed`];
  const e = new Date(end);
  const sameDay = e.toDateString() === s.toDateString();
  return [main, `${formatTime(start)} to ${sameDay ? "" : `${DAYS[e.getDay()]}, ${MONTHS[e.getMonth()]} ${e.getDate()} `}${formatTime(end)}`];
}

export function formatRange(start: number, end?: number) {
  const [day, time] = longWhen(start, end);
  return `${day} · ${time}`;
}

export function formatDistance(km: number | null, isOnline: boolean) {
  if (isOnline) return "Online";
  if (km === null) return "Location after RSVP";
  const miles = km * 0.621371;
  return miles < 1 ? "Under 1 mi" : `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

export const KM_PER_MILE = 1.609344;

export type FeedSection = "Today" | "This week" | "Later" | "Ongoing";

export function feedSection(start: number, now = Date.now()): FeedSection {
  const days = daysFromToday(start, now);
  if (days < 0) return "Ongoing";
  if (days === 0) return "Today";
  if (days < 7) return "This week";
  return "Later";
}

export function groupBySection<T extends { startTime: number }>(events: T[], now = Date.now()) {
  const order: FeedSection[] = ["Today", "This week", "Later", "Ongoing"];
  return order
    .map((title) => ({ title, data: events.filter((e) => feedSection(e.startTime, now) === title) }))
    .filter((s) => s.data.length > 0);
}

export const SOURCE_LABEL: Record<string, string> = { devpost: "Devpost", luma: "Luma", eventbrite: "Eventbrite", meetup: "Meetup", jsonld: "the organizer's page", seed: "Scout picks" };
