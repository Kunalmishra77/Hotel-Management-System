/**
 * Traceability: Phase 6 — command-centre date lens (extended time filters +
 * period-over-period deltas).
 *
 * The `?period=` param comes from a URL: unknown → month-to-date, and each preset
 * must anchor a correct [from, to] window, with an equal-length previous window
 * for deltas.
 */
import { describe, expect, it } from "vitest";
import { parsePeriod, periodRange, previousWindow, deltaPct } from "@/features/command-center/domain/period";

// 2026-08-14 (August = month 7, 0-indexed) — Q3, second half-year.
const TODAY = new Date("2026-08-14T00:00:00.000Z");

describe("parsePeriod", () => {
  it("accepts known presets and defaults unknown to mtd", () => {
    for (const p of ["today", "wtd", "mtd", "qtd", "htd", "ytd", "custom"]) expect(parsePeriod(p)).toBe(p);
    for (const bad of [undefined, null, "", "7d", "1y", 30]) expect(parsePeriod(bad)).toBe("mtd");
  });
});

describe("periodRange", () => {
  it("today starts at UTC midnight", () => {
    const { from } = periodRange("today", TODAY);
    expect(from.toISOString()).toBe("2026-08-14T00:00:00.000Z");
  });

  it("mtd starts on the first of the month", () => {
    const { from } = periodRange("mtd", TODAY);
    expect(from.getUTCDate()).toBe(1);
    expect(from.getUTCMonth()).toBe(7);
  });

  it("qtd starts on the first day of the quarter (July for August)", () => {
    const { from } = periodRange("qtd", TODAY);
    expect(from.getUTCMonth()).toBe(6);
    expect(from.getUTCDate()).toBe(1);
  });

  it("htd starts on the first day of the half-year (July for August)", () => {
    const { from } = periodRange("htd", TODAY);
    expect(from.getUTCMonth()).toBe(6);
  });

  it("ytd starts on Jan 1", () => {
    const { from } = periodRange("ytd", TODAY);
    expect(from.getUTCMonth()).toBe(0);
    expect(from.getUTCDate()).toBe(1);
  });

  it("custom reads from/to params", () => {
    const { from, to } = periodRange("custom", TODAY, { from: "2026-01-01", to: "2026-03-31" });
    expect(from.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(to.toISOString().slice(0, 10)).toBe("2026-03-31");
  });
});

describe("previousWindow", () => {
  it("is the equal-length window immediately before", () => {
    const win = periodRange("today", TODAY); // 1-day window (midnight → today)
    const prev = previousWindow(win);
    expect(prev.to.getTime()).toBe(win.from.getTime());
    expect(win.from.getTime() - prev.from.getTime()).toBe(win.to.getTime() - win.from.getTime());
  });

  it("mtd previous window is the same number of elapsed days before the month", () => {
    const win = periodRange("mtd", TODAY);
    const prev = previousWindow(win);
    const len = win.to.getTime() - win.from.getTime();
    expect(prev.from.getTime()).toBe(win.from.getTime() - len);
  });
});

describe("deltaPct", () => {
  it("computes signed percentage change", () => {
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(50, 100)).toBe(-50);
    expect(deltaPct(100, 100)).toBe(0);
  });
  it("returns null when the baseline is zero and current is not", () => {
    expect(deltaPct(100, 0)).toBeNull();
    expect(deltaPct(0, 0)).toBe(0);
  });
  it("uses the absolute baseline so a swing out of loss reads positive", () => {
    expect(deltaPct(100, -100)).toBe(200);
  });
});
