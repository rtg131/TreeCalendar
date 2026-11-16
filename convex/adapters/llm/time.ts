import { toZonedIso, zonedToUtc } from "../../lib/time";

export function toLocalWallTime(iso: string, timeZone: string): string | undefined {
  if (!/T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(iso)) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : toZonedIso(ms, timeZone).slice(0, 16);
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;

export function withOffset(value: string, timeZone: string): string {
  const m = LOCAL.exec(value);
  if (!m) return value;
  const [, y, mo, d, h, mi] = m.map(Number);
  return toZonedIso(zonedToUtc(y, mo - 1, d, h, mi, timeZone), timeZone);
}
