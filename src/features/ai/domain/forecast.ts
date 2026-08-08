/**
 * 18 T-6 — forecasting math (FR-6, AC-7). PURE and deterministic.
 *
 * The NUMBERS come from here — a least-squares linear trend over historical
 * daily snapshots plus a 7-day seasonal (day-of-week) adjustment. The LLM never
 * produces a figure; it only phrases the narrative around these values
 * (grounding over generation).
 */

export type SeriesPoint = { date: string; value: number };
export type ForecastPoint = { date: string; value: number };

/** The metrics 18 can forecast off the immutable daily snapshots (FR-6). */
export type ForecastMetric = "revenue" | "occupancy" | "expense" | "profit";

/** One day's forecastable figures, money already widened from BigInt to number-of-paise. */
export type SnapshotMetrics = { revenuePaise: number; occupancyBps: number; expensePaise: number };

/**
 * Select one forecastable series value from a day's snapshot. Pure so the metric
 * mapping is unit-testable without a DB.
 *
 * NOTE on `profit`: this is OPERATING profit = total revenue − direct (07-approved)
 * expenses as captured on the immutable `DailyStatSnapshot`. It deliberately
 * EXCLUDES the month-apportioned payroll cost that 08-profit-reports layers on at
 * report time (see reporting.md) — this is a directional forecast grounded on the
 * snapshot, not the canonical 08 profit figure. `expense` mirrors the snapshot's
 * `expensePaise` (07 approved), the same base 08 uses for its 07 portion.
 */
export function pickMetric(row: SnapshotMetrics, metric: ForecastMetric): number {
  switch (metric) {
    case "revenue":
      return row.revenuePaise;
    case "occupancy":
      return row.occupancyBps;
    case "expense":
      return row.expensePaise;
    case "profit":
      return row.revenuePaise - row.expensePaise;
  }
}

export type ForecastResult = {
  history: SeriesPoint[];
  forecast: ForecastPoint[];
  /** Slope sign as a plain-English direction for the (LLM) narrative. */
  trend: "up" | "down" | "flat";
  /** Percentage change of the forecast mean vs the history mean (rounded). */
  changePct: number;
};

/** Ordinary least-squares slope + intercept for y over x = 0..n-1. */
function linearFit(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: values[0] ?? 0 };
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    num += dx * ((values[i] ?? 0) - yMean);
    den += dx * dx;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: yMean - slope * xMean };
}

/** Average multiplicative day-of-week factor (index 0 = first history day). */
function seasonalFactors(values: number[], fit: { slope: number; intercept: number }): number[] {
  const factors = new Array<number>(7).fill(1);
  const counts = new Array<number>(7).fill(0);
  const ratios = new Array<number>(7).fill(0);
  for (let i = 0; i < values.length; i++) {
    const trend = fit.intercept + fit.slope * i;
    if (trend <= 0) continue;
    const dow = i % 7;
    ratios[dow] = (ratios[dow] ?? 0) + (values[i] ?? 0) / trend;
    counts[dow] = (counts[dow] ?? 0) + 1;
  }
  for (let d = 0; d < 7; d++) {
    const c = counts[d] ?? 0;
    factors[d] = c > 0 ? (ratios[d] ?? 0) / c : 1;
  }
  return factors;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Project `horizonDays` forward from a daily history series. Returns the history,
 * the forecast, and a plain trend descriptor for the narrative layer.
 */
export function forecastSeries(history: SeriesPoint[], horizonDays: number): ForecastResult {
  const values = history.map((p) => p.value);
  const fit = linearFit(values);
  const factors = seasonalFactors(values, fit);
  const n = values.length;
  const lastDate = history[n - 1]?.date ?? new Date().toISOString().slice(0, 10);

  const forecast: ForecastPoint[] = [];
  for (let h = 1; h <= horizonDays; h++) {
    const idx = n - 1 + h;
    const base = fit.intercept + fit.slope * idx;
    const factor = factors[idx % 7] ?? 1;
    forecast.push({ date: addDays(lastDate, h), value: Math.max(0, Math.round(base * factor)) });
  }

  const histMean = n > 0 ? values.reduce((a, b) => a + b, 0) / n : 0;
  const fcMean = forecast.length > 0 ? forecast.reduce((a, b) => a + b.value, 0) / forecast.length : 0;
  const changePct = histMean > 0 ? Math.round(((fcMean - histMean) / histMean) * 100) : 0;
  const trend = fit.slope > 0.0001 ? "up" : fit.slope < -0.0001 ? "down" : "flat";

  return { history, forecast, trend, changePct };
}
