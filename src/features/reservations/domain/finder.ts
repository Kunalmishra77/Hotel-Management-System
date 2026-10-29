/**
 * Bookings finder — pure parsing of the list filters that live in the URL, so the
 * Bookings pages (front desk + all-hotels) can deep-link any view: a KPI card or a
 * status chip is just a link with these params. No I/O.
 *
 *   prop    property id, or "all" (every property the user can access)
 *   status  a reservation status, or ATTENTION (OTA oversell / mapping flags)
 *   bdate   which date the range applies to: arrival | departure | stay | booked
 *   bfrom / bto   yyyy-mm-dd, inclusive
 *   sort    newest | arrival | departure | guest (A–Z)
 */

export const FINDER_STATUSES = ["ENQUIRY", "CONFIRMED", "IN_HOUSE", "CHECKED_OUT", "CANCELLED", "NO_SHOW", "ATTENTION"] as const;
export type FinderStatus = (typeof FINDER_STATUSES)[number];
export const FINDER_DATE_FIELDS = ["arrival", "departure", "stay", "booked"] as const;
export type FinderDateField = (typeof FINDER_DATE_FIELDS)[number];
export const FINDER_SORTS = ["newest", "arrival", "departure", "guest"] as const;
export type FinderSort = (typeof FINDER_SORTS)[number];

export type FinderParams = {
  prop: string; // a property id or "all"
  status: FinderStatus | null;
  dateField: FinderDateField;
  from: string | null;
  to: string | null;
  sort: FinderSort;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pick = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

export function parseFinderParams(
  sp: Record<string, string | undefined>,
  defaults: { prop: string },
): FinderParams {
  const from = sp.bfrom && ISO.test(sp.bfrom) ? sp.bfrom : null;
  const to = sp.bto && ISO.test(sp.bto) ? sp.bto : null;
  const dateField = pick(sp.bdate, FINDER_DATE_FIELDS, "arrival");
  // With a date window the natural order follows that date; otherwise newest first.
  const defaultSort: FinderSort = from || to ? (dateField === "departure" ? "departure" : dateField === "booked" ? "newest" : "arrival") : "newest";
  return {
    prop: sp.prop && sp.prop.trim() !== "" ? sp.prop : defaults.prop,
    status: (FINDER_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as FinderStatus) : null,
    dateField,
    // A single bound is fine ("arriving from today on"); a reversed range is swapped.
    from: from && to && from > to ? to : from,
    to: from && to && from > to ? from : to,
    sort: pick(sp.sort, FINDER_SORTS, defaultSort),
  };
}

/** Add `days` to a yyyy-mm-dd date (UTC calendar arithmetic). */
export function addDays(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** One-tap presets for the date range, relative to the property-local `today`. */
export function finderPresets(today: string): { key: string; label: string; from: string; to: string }[] {
  const dow = new Date(`${today}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
  const weekStart = addDays(today, -((dow + 6) % 7)); // Monday
  const monthStart = `${today.slice(0, 8)}01`;
  const nextMonth = new Date(`${monthStart}T00:00:00.000Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  return [
    { key: "today", label: "Today", from: today, to: today },
    { key: "tomorrow", label: "Tomorrow", from: addDays(today, 1), to: addDays(today, 1) },
    { key: "week", label: "This week", from: weekStart, to: addDays(weekStart, 6) },
    { key: "month", label: "This month", from: monthStart, to: addDays(nextMonth.toISOString().slice(0, 10), -1) },
  ];
}
