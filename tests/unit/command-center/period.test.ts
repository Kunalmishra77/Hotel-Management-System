/**
 * Traceability: Phase 6 — command-centre date lens.
 *
 * The `?period=` param comes from a URL: unknown → 30 days, and each period must
 * anchor a correct [from, today] window.
 */
import { describe, expect, it } from "vitest";
import { parsePeriod, periodRange } from "@/features/command-center/domain/period";

const TODAY = new Date("2026-08-14T00:00:00.000Z");
const DAY = 86_400_000;

describe("parsePeriod", () => {
  it("accepts known periods and defaults unknown to 30d", () => {
    for (const p of ["7d", "30d", "90d", "mtd"]) expect(parsePeriod(p)).toBe(p);
    for (const bad of [undefined, null, "", "1y", "7", 30]) expect(parsePeriod(bad)).toBe("30d");
  });
});

describe("periodRange", () => {
  it("spans the right window for rolling periods (inclusive of today)", () => {
    expect(periodRange("7d", TODAY).from.getTime()).toBe(TODAY.getTime() - 6 * DAY);
    expect(periodRange("30d", TODAY).from.getTime()).toBe(TODAY.getTime() - 29 * DAY);
    expect(periodRange("90d", TODAY).from.getTime()).toBe(TODAY.getTime() - 89 * DAY);
  });

  it("mtd starts on the first of the month", () => {
    const { from } = periodRange("mtd", TODAY);
    expect(from.getUTCDate()).toBe(1);
    expect(from.getUTCMonth()).toBe(TODAY.getUTCMonth());
  });
});
