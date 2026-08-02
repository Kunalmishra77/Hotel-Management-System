/**
 * 18 T-6 — forecast math (FR-6, AC-7). Numbers come from the series, not a model.
 */
import { describe, expect, it } from "vitest";
import { forecastSeries, type SeriesPoint } from "@/features/ai/domain/forecast";

function series(values: number[], start = "2026-01-01"): SeriesPoint[] {
  const d = new Date(`${start}T00:00:00.000Z`);
  return values.map((v, i) => {
    const dd = new Date(d);
    dd.setUTCDate(dd.getUTCDate() + i);
    return { date: dd.toISOString().slice(0, 10), value: v };
  });
}

describe("forecastSeries (AC-7)", () => {
  it("detects an upward trend and projects growth", () => {
    const r = forecastSeries(series([100, 110, 120, 130, 140, 150, 160, 170]), 7);
    expect(r.trend).toBe("up");
    expect(r.changePct).toBeGreaterThan(0);
    expect(r.forecast).toHaveLength(7);
    expect(r.forecast.every((p) => p.value >= 0)).toBe(true);
  });

  it("detects a downward trend", () => {
    const r = forecastSeries(series([200, 180, 160, 140, 120, 100, 80, 60]), 5);
    expect(r.trend).toBe("down");
    expect(r.changePct).toBeLessThan(0);
  });

  it("treats a flat series as flat", () => {
    const r = forecastSeries(series([100, 100, 100, 100, 100, 100, 100]), 3);
    expect(r.trend).toBe("flat");
  });

  it("never forecasts a negative value", () => {
    const r = forecastSeries(series([50, 40, 30, 20, 10, 5, 1]), 30);
    expect(r.forecast.every((p) => p.value >= 0)).toBe(true);
  });
});
