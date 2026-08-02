/**
 * nights() — 03 T-5 (FR-5, AC-2).
 *
 * Nights = the number of property-local calendar days between check-in and
 * check-out, with a floor of 1 (a same-day "day-use" stay is one night).
 *
 * Why calendar days, not `(out - in) / 86_400_000`: dividing milliseconds is
 * wrong across a DST boundary (a 23- or 25-hour day would round to the wrong
 * night count). We instead resolve each instant to its calendar date **in the
 * property's timezone** and subtract whole days — DST-immune by construction.
 *
 * The stored `checkInDate`/`checkOutDate` are `@db.Date` (already property-local
 * calendar dates), but this accepts full instants too and normalises them, so a
 * caller that passes a booking timestamp still gets the right local day.
 */

/** Epoch **day number** of `date` as seen in `tz` (days since 1970-01-01 local). */
function localEpochDay(date: Date, tz: string): number {
  // en-CA formats as YYYY-MM-DD, which parses unambiguously.
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .split("-")
    .map(Number);
  // Anchor to UTC midnight of that local date so the subtraction is exact.
  return Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

export function nights(checkIn: Date, checkOut: Date, tz = "Asia/Kolkata"): number {
  const diff = localEpochDay(checkOut, tz) - localEpochDay(checkIn, tz);
  // A same-day day-use stay is 1 night; a negative range is a validation error
  // caught upstream (FR-22) — never let this return 0 or a negative.
  return Math.max(1, diff);
}
