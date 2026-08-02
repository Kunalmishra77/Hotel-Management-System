/**
 * Property-local time helpers — pure, DST-safe (no date-fns-tz dependency).
 *
 * Mirrors the `Intl.DateTimeFormat` approach in `reservations/domain/nights.ts`:
 * resolve an instant to its wall-clock components in a timezone, and build a UTC
 * instant back from a local wall time. Used by quiet-hours (FR-21) and the
 * scheduled-send tick (FR-13).
 */

/** Minutes a `tz` local wall time is ahead of UTC at `date` (IST → +330). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** Epoch **day number** of `date` as seen in `tz` (days since 1970-01-01 local). */
export function localEpochDay(date: Date, tz: string): number {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .split("-")
    .map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

/** Wall-clock minutes-of-day (0..1439) of `date` in `tz`. */
export function localMinutesOfDay(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return get("hour") * 60 + get("minute");
}

/** The UTC instant of `minutes`-of-day on local `epochDay` in `tz`. */
export function zonedWallTimeToUtc(epochDay: number, minutes: number, tz: string): Date {
  // Guess by treating the local wall time as if it were UTC, then correct by the
  // tz offset at that guess. One correction is exact outside the ~1h/year DST
  // transition edges (India has no DST, so it is always exact here).
  const guess = new Date(epochDay * 86_400_000 + minutes * 60_000);
  const offset = tzOffsetMinutes(guess, tz);
  return new Date(guess.getTime() - offset * 60_000);
}

/** Parse "HH:mm" to minutes-of-day, or null when unset/malformed. */
export function parseHhMm(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
