/**
 * Command-centre date lens (Phase 6) — pure. A `?period=` param picks the window
 * the portfolio + trend are computed over; an unknown value falls back to 30 days.
 */
export const PERIODS = ["7d", "30d", "90d", "mtd"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<Period, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  mtd: "Month to date",
};

export function parsePeriod(v: unknown): Period {
  return typeof v === "string" && (PERIODS as readonly string[]).includes(v) ? (v as Period) : "30d";
}

/** The [from, today] window + a human label for a period, anchored on `today`. */
export function periodRange(period: Period, today: Date): { from: Date; label: string } {
  if (period === "mtd") {
    return {
      from: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
      label: "month to date",
    };
  }
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  return { from: new Date(today.getTime() - (days - 1) * 86_400_000), label: `last ${days} days` };
}
