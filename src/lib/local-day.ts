/**
 * Property-local days (data-model.md: store UTC, interpret business dates in the
 * property timezone). Every property runs on IST today, so "today" computed from
 * the UTC calendar was wrong from 00:00 to 05:30 — the dashboard and billing
 * tiles showed yesterday.
 *
 * Two shapes, because two kinds of column exist:
 *  - `@db.Date` business dates (checkInDate, spentOn, businessDate) compare
 *    against the local calendar day held at UTC midnight → `localToday`;
 *  - timestamps (receivedAt, issuedAt) compare against the real instants at which
 *    the local day starts and ends → `localDayInstants`.
 */
export const DEFAULT_TZ = "Asia/Kolkata";
const DAY_MS = 86_400_000;

/** The property-local calendar day of `now`, as a UTC-midnight date. */
export function localToday(tz: string = DEFAULT_TZ, now: Date = new Date()): Date {
  return new Date(`${now.toLocaleDateString("en-CA", { timeZone: tz })}T00:00:00.000Z`);
}

/** Minutes the zone is ahead of UTC at `at` (IST → 330). */
function offsetMinutes(tz: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * The [start, next) instants of a local calendar day. `day` is that day held at
 * UTC midnight (as `localToday` returns, or a `yyyy-mm-ddT00:00Z` date).
 */
export function localDayInstants(day: Date, tz: string = DEFAULT_TZ): { start: Date; next: Date } {
  const off = offsetMinutes(tz, day) * 60_000;
  return { start: new Date(day.getTime() - off), next: new Date(day.getTime() + DAY_MS - off) };
}
