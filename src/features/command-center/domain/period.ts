/**
 * Command-centre date lens — pure, UTC-anchored. A `?period=` param (or a
 * `?from=&to=` custom pair) picks the window the portfolio, trend and segments are
 * computed over. Every preset also yields an equal-length PREVIOUS window so the
 * dashboard can show period-over-period deltas (▲▼) — the owner's "am I up or
 * down vs before" read. Unknown values fall back to month-to-date.
 */
export const PERIODS = ["today", "wtd", "mtd", "qtd", "htd", "ytd", "custom"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<Period, string> = {
  today: "Today",
  wtd: "This week",
  mtd: "This month",
  qtd: "This quarter",
  htd: "This half-year",
  ytd: "This year",
  custom: "Custom",
};

/** The presets shown as quick chips (custom is entered via the date inputs). */
export const PERIOD_PRESETS: Period[] = ["today", "wtd", "mtd", "qtd", "htd", "ytd"];

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const startOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const startOfQuarter = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
const startOfHalf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 6) * 6, 1));
const startOfYear = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
const startOfWeek = (d: Date) => {
  // ISO week: Monday = 0.
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(startOfDay(d).getTime() - offset * DAY);
};

export function parsePeriod(v: unknown): Period {
  return typeof v === "string" && (PERIODS as readonly string[]).includes(v) ? (v as Period) : "mtd";
}

/** Parse a `YYYY-MM-DD` (UTC) or return null. */
function parseISODate(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type DateWindow = { from: Date; to: Date; label: string };

/**
 * The [from, to] window + a human label for a period, anchored on `today`. For
 * `custom`, `from`/`to` come from the query (falls back to this month if absent).
 */
export function periodRange(
  period: Period,
  today: Date,
  custom?: { from?: unknown; to?: unknown },
): DateWindow {
  const to = today;
  switch (period) {
    case "today":
      return { from: startOfDay(today), to, label: "today" };
    case "wtd":
      return { from: startOfWeek(today), to, label: "this week" };
    case "qtd":
      return { from: startOfQuarter(today), to, label: "quarter to date" };
    case "htd":
      return { from: startOfHalf(today), to, label: "half-year to date" };
    case "ytd":
      return { from: startOfYear(today), to, label: "year to date" };
    case "custom": {
      const from = parseISODate(custom?.from) ?? startOfMonth(today);
      const cto = parseISODate(custom?.to) ?? today;
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      return { from, to: cto, label: `${fmt(from)} → ${fmt(cto)}` };
    }
    case "mtd":
    default:
      return { from: startOfMonth(today), to, label: "month to date" };
  }
}

/**
 * The equal-length window immediately BEFORE `window` — the comparison baseline
 * for period-over-period deltas. E.g. a 15-day month-to-date compares against the
 * 15 days before the month began.
 */
export function previousWindow(window: DateWindow): { from: Date; to: Date } {
  const len = window.to.getTime() - window.from.getTime();
  return { from: new Date(window.from.getTime() - len), to: window.from };
}

/** Signed percentage change, or null when the baseline is zero (no basis to compare). */
export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
